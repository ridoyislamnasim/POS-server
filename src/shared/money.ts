import { Decimal } from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal;

export function money(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

/** Locked rounding order: unit → line discount → taxable → tax → line round → invoice total */
export function roundMoney(value: MoneyInput, scale = 2): Decimal {
  return money(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

export function lineTotals(input: {
  unitPrice: MoneyInput;
  qty: number;
  lineDiscount?: MoneyInput;
  taxRatePercent: MoneyInput;
  taxInclusive?: boolean;
}) {
  const qty = money(input.qty);
  const unit = money(input.unitPrice);
  const discount = money(input.lineDiscount ?? 0);
  const rate = money(input.taxRatePercent).div(100);

  const extended = unit.mul(qty);
  const afterDiscount = Decimal.max(extended.minus(discount), 0);

  let taxable: Decimal;
  let tax: Decimal;
  let lineTotal: Decimal;

  if (input.taxInclusive) {
    lineTotal = roundMoney(afterDiscount);
    tax = roundMoney(lineTotal.minus(lineTotal.div(rate.plus(1))));
    taxable = roundMoney(lineTotal.minus(tax));
  } else {
    taxable = roundMoney(afterDiscount);
    tax = roundMoney(taxable.mul(rate));
    lineTotal = roundMoney(taxable.plus(tax));
  }

  return {
    extended: roundMoney(extended),
    discount: roundMoney(discount),
    taxable,
    tax,
    lineTotal,
  };
}

export function invoiceTotals(
  lines: { lineTotal: MoneyInput; tax: MoneyInput; taxable: MoneyInput; discount: MoneyInput }[],
  transactionDiscount: MoneyInput = 0,
) {
  const txDiscount = roundMoney(transactionDiscount);
  const subtotal = roundMoney(lines.reduce((s, l) => s.plus(money(l.taxable)), money(0)));
  const tax = roundMoney(lines.reduce((s, l) => s.plus(money(l.tax)), money(0)));
  const lineDiscount = roundMoney(lines.reduce((s, l) => s.plus(money(l.discount)), money(0)));
  const total = roundMoney(subtotal.plus(tax).minus(txDiscount));
  return { subtotal, tax, discount: roundMoney(lineDiscount.plus(txDiscount)), total };
}

export function toMoneyString(value: MoneyInput, scale = 4): string {
  return money(value).toFixed(scale);
}
