import { Biodata, ContactUnlock, Dislike, Favorite } from '../models/index.js';
import { isPublic, toCard, toContact, toListEntry } from '../serializers/biodata.serializer.js';
import { pageParams, paged, paginate } from '../utils/pagination.js';
import { assertNotOwn, findByNumber, findPublic } from './biodata.service.js';
import { notify } from './notification.service.js';

// Personal lists: favorites, dislikes ("not interested"), who favorited me, unlocked contacts.

const LISTS = {
  favorite: { Model: Favorite, other: Dislike },
  dislike: { Model: Dislike, other: Favorite },
};

const adjustFavoriteCount = (biodataId, by) =>
  Biodata.updateOne({ _id: biodataId }, { $inc: { 'stats.favorites': by } });

/**
 * Adds a biodata to a list (idempotent). A biodata cannot be in both lists, so
 * adding it to one removes it from the other.
 * @param {'favorite' | 'dislike'} list
 */
export async function addToList(list, user, biodataNo) {
  const { Model, other } = LISTS[list];
  const b = await findPublic(biodataNo);
  assertNotOwn(b, user);
  const result = await Model.updateOne(
    { user: user._id, biodata: b._id },
    { $setOnInsert: { user: user._id, biodata: b._id } },
    { upsert: true },
  );
  if (!result.upsertedCount) return;
  const removed = await other.deleteOne({ user: user._id, biodata: b._id });
  if (list === 'favorite') {
    await adjustFavoriteCount(b._id, 1);
    await notify(b.user, 'favorited', { biodataNo: b.biodataNo }, '/dashboard/favorited-me');
  } else if (removed.deletedCount) {
    await adjustFavoriteCount(b._id, -1);
  }
}

/** @param {'favorite' | 'dislike'} list */
export async function removeFromList(list, user, biodataNo) {
  const { Model } = LISTS[list];
  const b = await findByNumber(biodataNo);
  const result = await Model.deleteOne({ user: user._id, biodata: b._id });
  if (result.deletedCount && list === 'favorite') await adjustFavoriteCount(b._id, -1);
}

/** @param {'favorite' | 'dislike'} list */
export function listEntries(list, user, query) {
  const { Model } = LISTS[list];
  const filter = { user: user._id };
  return paginate(
    Model.find(filter).sort({ createdAt: -1 }).populate('biodata'),
    Model.countDocuments(filter),
    pageParams(query, { defaultLimit: 24 }),
    (row) => toListEntry(row.biodata, { addedAt: row.createdAt }),
  );
}

/** People who favorited my biodata: their biodata when public, otherwise anonymous. */
export async function favoritedMe(user, query) {
  const params = pageParams(query, { defaultLimit: 24 });
  const mine = await Biodata.findOne({ user: user._id }).select('_id');
  if (!mine) return paged([], 0, params);
  const filter = { biodata: mine._id };
  const [rows, total] = await Promise.all([
    Favorite.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit).lean(),
    Favorite.countDocuments(filter),
  ]);
  const theirs = await Biodata.find({ user: { $in: rows.map((r) => r.user) } });
  const byUser = new Map(theirs.map((x) => [x.user.toString(), x]));
  const items = rows.map((r) => {
    const b = byUser.get(r.user.toString());
    return b && isPublic(b)
      ? { ...toCard(b), addedAt: r.createdAt }
      : { anonymous: true, addedAt: r.createdAt };
  });
  return paged(items, total, params);
}

/** Contacts the member paid for. They stay visible even if the biodata is later hidden. */
export async function unlockedContacts(user, query) {
  const params = pageParams(query, { defaultLimit: 24 });
  const filter = { user: user._id };
  const [rows, total] = await Promise.all([
    ContactUnlock.find(filter)
      .sort({ createdAt: -1 })
      .skip(params.skip)
      .limit(params.limit)
      .populate('biodata'),
    ContactUnlock.countDocuments(filter),
  ]);
  const items = rows
    .filter((r) => r.biodata)
    .map((r) => ({
      ...toCard(r.biodata),
      unavailable: !isPublic(r.biodata),
      unlockedAt: r.createdAt,
      contact: toContact(r.biodata),
    }));
  return paged(items, total, params);
}
