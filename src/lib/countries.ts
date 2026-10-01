export const COUNTRIES: [string, string][] = [
  ["KE", "Kenya"], ["TZ", "Tanzania"], ["UG", "Uganda"], ["RW", "Rwanda"], ["ET", "Ethiopia"],
  ["NG", "Nigeria"], ["GH", "Ghana"], ["ZA", "South Africa"], ["EG", "Egypt"],
  ["US", "United States"], ["CA", "Canada"], ["MX", "Mexico"], ["BR", "Brazil"],
  ["GB", "United Kingdom"], ["FR", "France"], ["ES", "Spain"], ["DE", "Germany"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["IN", "India"], ["PH", "Philippines"], ["ID", "Indonesia"], ["JP", "Japan"], ["AU", "Australia"],
];

export const COUNTRY_CODES = COUNTRIES.map(([c]) => c);
export const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
