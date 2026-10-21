import {
  Biodata,
  ContactUnlock,
  Dislike,
  Favorite,
  Payment,
  Proposal,
  SupportTicket,
} from '../models/index.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { countUnread } from './notification.service.js';
import { recentProposals } from './proposal.service.js';
import { visitStats } from './visit.service.js';

/** Everything the member dashboard's overview page shows, in one call. */
export async function memberDashboard(user) {
  const uid = user._id;
  const b = await Biodata.findOne({ user: uid });
  const [
    visits,
    favoritedBy,
    favorites,
    dislikes,
    unlocks,
    sent,
    received,
    unread,
    openTickets,
    lastPurchase,
    recent,
  ] = await Promise.all([
    b ? visitStats(b._id) : { today: 0, week: 0, month: 0 },
    b ? Favorite.countDocuments({ biodata: b._id }) : 0,
    Favorite.countDocuments({ user: uid }),
    Dislike.countDocuments({ user: uid }),
    ContactUnlock.countDocuments({ user: uid }),
    Proposal.countDocuments({ from: uid }),
    Proposal.countDocuments({ to: uid }),
    countUnread(uid),
    SupportTicket.countDocuments({ user: uid, status: { $ne: 'closed' } }),
    Payment.findOne({ user: uid, status: 'verified' }).sort({ creditedAt: -1 }).select('creditedAt').lean(),
    recentProposals(uid),
  ]);
  return {
    user: toUserDTO(user),
    biodata: b && {
      biodataNo: b.biodataNo,
      status: b.status,
      isHidden: b.isHidden,
      deletedAt: b.deletedAt,
      completion: b.completion,
      type: b.type,
      district: b.district,
      nidStatus: b.nid?.status ?? 'not_submitted',
      rejectionReason: b.rejectionReason ?? null,
    },
    connections: {
      balance: user.connectionBalance,
      used: user.connectionsUsed,
      purchased: user.connectionsPurchased,
      lastPurchaseAt: lastPurchase?.creditedAt ?? null,
    },
    stats: { visits, favoritedBy },
    counts: {
      favorites,
      dislikes,
      favoritedMe: favoritedBy,
      unlocks,
      sentProposals: sent,
      receivedProposals: received,
      unreadNotifications: unread,
      openTickets,
    },
    recentProposals: recent,
  };
}
