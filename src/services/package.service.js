import { Package, Payment } from '../models/index.js';
import { toPackageDTO } from '../serializers/payment.serializer.js';
import { notFound } from '../utils/api-error.js';
import { recordAudit } from './audit.service.js';

/** Every package (active or not) with its sales figures. */
export async function listPackages() {
  const [items, sold] = await Promise.all([
    Package.find().sort({ sortOrder: 1, price: 1 }),
    Payment.aggregate([
      { $match: { status: 'verified' } },
      { $group: { _id: '$package', n: { $sum: 1 }, revenue: { $sum: '$amount' } } },
    ]),
  ]);
  const byId = new Map(sold.map((s) => [String(s._id), s]));
  return items.map((p) => ({
    ...toPackageDTO(p),
    sold: byId.get(p._id.toString())?.n ?? 0,
    revenue: byId.get(p._id.toString())?.revenue ?? 0,
  }));
}

export async function createPackage(data, ctx) {
  const pkg = await Package.create(data);
  await recordAudit(ctx, 'package.create', {
    targetType: 'package',
    targetId: pkg._id,
    summary: `Created package ${pkg.name.en}`,
  });
  return toPackageDTO(pkg);
}

export async function updatePackage(id, data, ctx) {
  const pkg = await Package.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!pkg) throw notFound('Package');
  await recordAudit(ctx, 'package.update', {
    targetType: 'package',
    targetId: pkg._id,
    summary: `Updated package ${pkg.name.en}`,
    meta: data,
  });
  return toPackageDTO(pkg);
}

/** Deletes an unused package; a package with payments is retired instead, so history stays readable. */
export async function removePackage(id, ctx) {
  const pkg = await Package.findById(id);
  if (!pkg) throw notFound('Package');
  if (await Payment.exists({ package: pkg._id })) {
    pkg.isActive = false;
    await pkg.save();
  } else {
    await pkg.deleteOne();
  }
  await recordAudit(ctx, 'package.delete', {
    targetType: 'package',
    targetId: pkg._id,
    summary: `Removed package ${pkg.name.en}`,
  });
}
