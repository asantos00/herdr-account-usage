const CURRENCY_SYMBOLS = Object.freeze({ USD: "$", EUR: "€", GBP: "£" });

function money(amountMinor, currency, exponent) {
  const value = (amountMinor / (10 ** exponent)).toFixed(exponent).replace(/\.00$/, "");
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

export function extraUsageWords(window) {
  const used = Number(window?.usedAmountMinor), limit = Number(window?.limitAmountMinor);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || !window?.currency) return "Credit usage";
  const exponent = Number.isFinite(Number(window.exponent)) ? Number(window.exponent) : 2;
  return `${money(used, window.currency, exponent)} / ${money(limit, window.currency, exponent)}`;
}
