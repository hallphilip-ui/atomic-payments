// OFAC-sanctioned digital-currency addresses (local baseline).
//
// This is a curated seed of well-known OFAC SDN crypto addresses (e.g. the
// Tornado Cash designations of Aug/Nov 2022) so screening works offline and
// deterministically with no external dependency. It is NOT exhaustive.
//
// The authoritative, live source is the Chainalysis sanctions oracle (enabled
// with ATOMIC_CHAINALYSIS_API_KEY). Refresh/expand this local list from the
// official OFAC SDN with:  node scripts/update-ofac-addresses.js
//
// Matching is case-insensitive; addresses are normalized to lowercase at load.
export const OFAC_SANCTIONED_ADDRESS_SEED: string[] = [
  // Tornado Cash (Ethereum) — OFAC SDN
  '0x8589427373D6D84E98730D7795D8f6f8731FDA16',
  '0x722122dF12D4e14e13Ac3b6895a86e84145b6967',
  '0xDD4c48C0B24039969fC16D1cdF626eaB821d3384',
  '0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b',
  '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291',
  '0xF60dD140cFf0706bAE9Cd734Ac3ae76AD9eBC32A',
  '0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3',
  '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF',
  '0xb1C8094B234DcE6e03f10a5b673c1d8C69739A00',
  '0x22aaA7720ddd5388A3c0A3333430953C68f1849b'
];

// Normalized lookup set (lowercase). Loaded once at module import.
export const OFAC_SANCTIONED_ADDRESSES: Set<string> = new Set(
  OFAC_SANCTIONED_ADDRESS_SEED.map((address) => address.trim().toLowerCase())
);
