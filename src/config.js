// Default rules taken from the SOP. Nothing here is month-specific.
// Users can edit these in the Settings tab; changes persist in the browser (localStorage)
// and can be exported/imported as JSON.

export const DEFAULT_CONFIG = {
  incomeAccount: 'Rental Income',
  journal: { prefix: 'WIRC', separator: '-', pad: 3 },

  // Payout must equal the sum of its lines within this amount (SOP step 3).
  tolerance: 0.02,
  // A QBO deposit may land this many days before / after the Airbnb payout date (ACH lag).
  matchWindow: { before: 3, after: 14 },
  stripeWindowDays: 8,

  // Matched against the text in the Airbnb payout "Details" column (case-insensitive).
  destinations: {
    '2665': { label: 'Steven Garcia, Checking 2665', booked: true },
    '1393': { label: 'CPC Checking 1393', booked: true },
    'PayPal': { label: 'PayPal (NOLA manager share)', booked: false,
      reason: 'NOLA property manager contractual share paid by Airbnb. Not Steven\'s income.' },
    '6673': { label: 'Empire Tours, Checking 6673', booked: false, flagPropertyBookings: true,
      reason: 'Empire\'s own account, outside Steven\'s books.' },
  },

  // Airbnb listing -> QBO class (SOP classification table). Matching ignores case and spacing around "|".
  listings: [
    { name: 'Wisconsin Luxury Log Mansion | Sleeps 15', cls: 'Cassville WI' },
    { name: 'Wisconsin Log Cabin | Stunning Views | Sleeps 16', cls: 'Cassville WI' },
    { name: 'Entire Property | 2 Luxury Lodges | Sleeps 31', cls: 'Cassville WI' },
    { name: 'Spacious Condo | Steps to French Quarter', cls: 'NOLA' },
    { name: 'Glamping Cabin | Huge Window | Tree House Feel', cls: 'Ohio Homesteading' },
    { name: 'Glamping Cabin | Huge Window | Nature Lovers Dream', cls: 'Ohio Homesteading' },
    { name: 'Glamping Cabin | Huge Window | Over a Creek', cls: 'Ohio Homesteading' },
    { name: 'Glamping Cabin| Huge Window|Valley and Cliff Views', cls: 'Ohio Homesteading' },
    { name: 'Glamping Cabin | Huge Window| Unique Boulder Views', cls: 'Ohio Homesteading' },
    { name: 'Glamping Cabin |Huge Window|Cliff and Animal Views', cls: 'Ohio Homesteading' },
    { name: 'Sleeps 4| Private Bathroom | Stunning Views', cls: 'Ohio Homesteading' },
    { name: 'Sleeps 12| Huge Windows | Stunning Views', cls: 'Ohio Homesteading' },
  ],

  // Stripe descriptions use slightly different listing names, so these keyword rules run after the
  // exact table lookup. First match wins. Anything unmatched is flagged as a new listing.
  stripeRules: [
    { contains: 'wisconsin', cls: 'Cassville WI' },
    { contains: '2 luxury lodges', cls: 'Cassville WI' },
    { contains: 'french quarter', cls: 'NOLA' },
    { contains: 'pownall', cls: 'Pownall' },
    { contains: 'glamping cabin', cls: 'Ohio Homesteading' },
    { contains: 'sleeps 4|', cls: 'Ohio Homesteading' },
    { contains: 'sleeps 12|', cls: 'Ohio Homesteading' },
  ],

  classes: ['Cassville WI', 'NOLA', 'Ohio Homesteading', 'Pownall'],
};

export function mergeConfig(saved) {
  const base = structuredClone(DEFAULT_CONFIG);
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (saved[k] === undefined) continue;
    base[k] = (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? { ...base[k], ...saved[k] } : saved[k];
  }
  return base;
}
