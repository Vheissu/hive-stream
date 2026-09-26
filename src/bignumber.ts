import BigNumberJS from 'bignumber.js';

// bignumber.js 10+ defaults to STRICT mode, which throws on non-numeric input
// instead of producing NaN. The library validates amounts with isNaN() and
// isFinite() checks, so it uses a private lenient clone rather than changing
// the global constructor that application code may share.
const BigNumber = BigNumberJS.clone({ STRICT: false });

type BigNumber = BigNumberJS;

export type RoundingMode = BigNumberJS.RoundingMode;

export default BigNumber;
