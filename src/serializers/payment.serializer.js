export function toPackageDTO(p) {
  return {
    id: p._id.toString(),
    name: p.name,
    description: p.description ?? null,
    connections: p.connections,
    price: p.price,
    perConnection: Math.round(p.price / p.connections),
    highlight: !!p.highlight,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}

export function toPaymentDTO(p) {
  return {
    id: p._id.toString(),
    invoiceNo: p.invoiceNo,
    packageName: p.packageName,
    connections: p.connections,
    amount: p.amount,
    method: p.method,
    mode: p.mode,
    senderNumber: p.senderNumber ?? null,
    trxId: p.trxId ?? null,
    status: p.status,
    rejectReason: p.rejectReason ?? null,
    createdAt: p.createdAt,
    creditedAt: p.creditedAt ?? null,
    refundedAt: p.refundedAt ?? null,
  };
}

export function toLedgerEntryDTO(t) {
  return {
    id: t._id,
    type: t.type,
    delta: t.delta,
    balanceAfter: t.balanceAfter,
    reason: t.reason ?? null,
    createdAt: t.createdAt,
    biodataNo: t.biodata?.biodataNo ?? null,
    invoiceNo: t.payment?.invoiceNo ?? null,
  };
}
