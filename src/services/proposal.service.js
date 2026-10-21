import { Biodata, Proposal } from '../models/index.js';
import { toListEntry } from '../serializers/biodata.serializer.js';
import { ApiError, conflict, notFound } from '../utils/api-error.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { assertNotOwn, findPublic } from './biodata.service.js';
import { notify } from './notification.service.js';

const DAILY_LIMIT = 20;

/** Sends a proposal to the owner of a public biodata. */
export async function sendProposal(user, biodataNo, message) {
  const b = await findPublic(biodataNo);
  assertNotOwn(b, user, 'You cannot send a proposal to your own biodata.');
  if (await Proposal.exists({ from: user._id, toBiodata: b._id, status: { $in: ['pending', 'accepted'] } })) {
    throw conflict('PROPOSAL_EXISTS', 'You have already sent a proposal to this biodata.');
  }
  const sentToday = await Proposal.countDocuments({
    from: user._id,
    createdAt: { $gte: new Date(Date.now() - 864e5) },
  });
  if (sentToday >= DAILY_LIMIT) {
    throw new ApiError(429, 'PROPOSAL_LIMIT', `You can send up to ${DAILY_LIMIT} proposals a day.`);
  }
  const mine = await Biodata.findOne({ user: user._id, deletedAt: null }).select('_id biodataNo');
  const proposal = await Proposal.create({
    from: user._id,
    fromBiodata: mine?._id,
    to: b.user,
    toBiodata: b._id,
    message,
  });
  await notify(
    b.user,
    'proposal_received',
    { fromBiodataNo: mine?.biodataNo ?? null },
    '/dashboard/proposals?box=received',
  );
  return { id: proposal._id, status: proposal.status, direction: 'sent' };
}

/** @param {'sent' | 'received'} box */
export function listProposals(user, { box, status }, query) {
  const filter = box === 'sent' ? { from: user._id } : { to: user._id };
  if (status) filter.status = status;
  return paginate(
    Proposal.find(filter).sort({ createdAt: -1 }).populate('fromBiodata toBiodata'),
    Proposal.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (p) => ({
      id: p._id,
      status: p.status,
      message: p.message ?? null,
      responseNote: p.responseNote ?? null,
      createdAt: p.createdAt,
      respondedAt: p.respondedAt ?? null,
      biodata: box === 'sent' ? toListEntry(p.toBiodata) : p.fromBiodata ? toListEntry(p.fromBiodata) : null,
    }),
  );
}

/** The receiver accepts or declines a pending proposal. */
export async function respondToProposal(user, id, { action, note }) {
  const status = action === 'accept' ? 'accepted' : 'declined';
  const p = await Proposal.findOneAndUpdate(
    { _id: id, to: user._id, status: 'pending' },
    { status, respondedAt: new Date(), responseNote: note },
    { new: true },
  ).populate('toBiodata', 'biodataNo');
  if (!p) throw notFound('Proposal');
  await notify(
    p.from,
    `proposal_${status}`,
    { biodataNo: p.toBiodata?.biodataNo },
    '/dashboard/proposals?box=sent',
  );
  return { id: p._id, status: p.status };
}

export async function withdrawProposal(user, id) {
  const p = await Proposal.findOneAndUpdate(
    { _id: id, from: user._id, status: 'pending' },
    { status: 'withdrawn' },
    { new: true },
  );
  if (!p) throw conflict('NOT_PENDING', 'Only pending proposals can be withdrawn.');
  return { id: p._id, status: p.status };
}

/** The 5 latest proposals in either direction, for the dashboard. */
export async function recentProposals(userId) {
  const rows = await Proposal.find({ $or: [{ from: userId }, { to: userId }] })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('fromBiodata toBiodata', 'biodataNo')
    .lean();
  return rows.map((p) => {
    const outgoing = p.from.equals(userId);
    return {
      id: p._id,
      direction: outgoing ? 'sent' : 'received',
      status: p.status,
      createdAt: p.createdAt,
      biodataNo: outgoing ? p.toBiodata?.biodataNo : (p.fromBiodata?.biodataNo ?? null),
    };
  });
}
