const monthsBetween = (start, end) => {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
};

export function computeDepreciatedValue(asset, asOf = new Date()) {
  const purchaseCost = Number(asset.purchaseCost) || 0;
  const salvageValue = Number(asset.salvageValue) || 0;
  if (asset.depreciationMethod === 'none' || !asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) {
    return purchaseCost;
  }
  const depreciableBase = Math.max(0, purchaseCost - salvageValue);
  const monthsElapsed = monthsBetween(asset.purchaseDate, asOf);
  const depreciation = Math.min(depreciableBase, (depreciableBase / asset.usefulLifeMonths) * monthsElapsed);
  return Math.max(salvageValue, purchaseCost - depreciation);
}

export function buildDepreciationSchedule(asset) {
  const purchaseCost = Number(asset.purchaseCost) || 0;
  const salvageValue = Number(asset.salvageValue) || 0;
  const usefulLifeMonths = Number(asset.usefulLifeMonths) || 0;

  if (asset.depreciationMethod === 'none' || usefulLifeMonths <= 0) {
    return [];
  }

  const depreciableBase = Math.max(0, purchaseCost - salvageValue);
  const monthlyDepreciation = depreciableBase / usefulLifeMonths;
  const start = new Date(asset.purchaseDate);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const rows = [];
  let accumulated = 0;

  for (let month = 0; month <= usefulLifeMonths; month += 1) {
    const periodDate = new Date(start.getFullYear(), start.getMonth() + month, 1);
    const opening = Math.max(salvageValue, purchaseCost - accumulated);
    const periodDepreciation =
      month === 0 ? 0 : Math.min(monthlyDepreciation, Math.max(0, opening - salvageValue));
    accumulated = Math.min(depreciableBase, accumulated + periodDepreciation);
    const closing = Math.max(salvageValue, purchaseCost - accumulated);

    rows.push({
      period: periodDate.toISOString(),
      periodLabel: periodDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      openingValue: Number(opening.toFixed(2)),
      depreciation: Number(periodDepreciation.toFixed(2)),
      accumulatedDepreciation: Number(accumulated.toFixed(2)),
      closingValue: Number(closing.toFixed(2)),
    });
  }

  return rows;
}
