// The 50 countries this game counts as European: the 46 members of the Council of Europe,
// plus Belarus, Kosovo, Russia and Vatican City. Area, borders and landlocked status come from
// the world-countries package and population from the World Bank (2025) at build time; the
// memberships below were checked against EU, NATO, Schengen and euro-area lists as of November 2026.
//
// fame: how readily the country comes to mind (10 = almost everyone says it). Drives rarity estimates.
// cap: capital in English; capAlt: other accepted spellings, including the local name.
// alt: other accepted names for the country (native names in many languages are added automatically).
export const RULE = "Europe here means the 46 Council of Europe members plus Belarus, Kosovo, Russia and Vatican City.";

export const COUNTRIES = [
  { id: "IS", n: "Iceland", fame: 6, cap: "Reykjavík", capAlt: [], fam: "germanic", tz: 0, alt: [] },
  { id: "IE", n: "Ireland", fame: 9, cap: "Dublin", capAlt: ["Baile Átha Cliath"], fam: "germanic", tz: 0, alt: ["Republic of Ireland", "Éire", "Eire"] },
  { id: "GB", n: "United Kingdom", fame: 10, cap: "London", capAlt: ["Londres", "Londra"], fam: "germanic", tz: 0, the: 1,
    alt: ["UK", "U.K.", "Britain", "Great Britain", "GB", "United Kingdom of Great Britain and Northern Ireland"] },
  { id: "PT", n: "Portugal", fame: 8, cap: "Lisbon", capAlt: ["Lisboa", "Lissabon", "Lisbonne"], fam: "romance", tz: 0, alt: [] },
  { id: "ES", n: "Spain", fame: 10, cap: "Madrid", capAlt: [], fam: "romance", tz: 1, alt: ["España", "Espana"] },
  { id: "FR", n: "France", fame: 10, cap: "Paris", capAlt: ["Parigi"], fam: "romance", tz: 1, alt: [] },
  { id: "BE", n: "Belgium", fame: 7, cap: "Brussels", capAlt: ["Bruxelles", "Brussel", "Brüssel"], fam: "germanic", tz: 1, alt: [] },
  { id: "NL", n: "Netherlands", fame: 8, cap: "Amsterdam", capAlt: [], fam: "germanic", tz: 1, the: 1, alt: ["Holland", "The Netherlands", "Nederland"] },
  { id: "LU", n: "Luxembourg", fame: 5, cap: "Luxembourg City", capAlt: ["Luxembourg", "Luxemburg", "Lëtzebuerg"], fam: "germanic", tz: 1, alt: ["Luxemburg"] },
  { id: "DE", n: "Germany", fame: 10, cap: "Berlin", capAlt: ["Berlino"], fam: "germanic", tz: 1, alt: ["Deutschland", "West Germany"] },
  { id: "CH", n: "Switzerland", fame: 7, cap: "Bern", capAlt: ["Berne", "Berna"], fam: "germanic", tz: 1, alt: ["Swiss", "Schweiz", "Suisse", "Svizzera"] },
  { id: "AT", n: "Austria", fame: 7, cap: "Vienna", capAlt: ["Wien", "Vienne", "Viena"], fam: "germanic", tz: 1, alt: ["Österreich", "Oesterreich"] },
  { id: "IT", n: "Italy", fame: 10, cap: "Rome", capAlt: ["Roma", "Rom"], fam: "romance", tz: 1, alt: ["Italia"] },
  { id: "DK", n: "Denmark", fame: 7, cap: "Copenhagen", capAlt: ["København", "Kobenhavn", "Kopenhagen"], fam: "germanic", tz: 1, alt: ["Danmark"] },
  { id: "NO", n: "Norway", fame: 7, cap: "Oslo", capAlt: [], fam: "germanic", tz: 1, alt: ["Norge", "Noreg"] },
  { id: "SE", n: "Sweden", fame: 7, cap: "Stockholm", capAlt: [], fam: "germanic", tz: 1, alt: ["Sverige"] },
  { id: "FI", n: "Finland", fame: 6, cap: "Helsinki", capAlt: ["Helsingfors"], fam: "uralic", tz: 2, alt: ["Suomi"] },
  { id: "EE", n: "Estonia", fame: 4, cap: "Tallinn", capAlt: ["Tallin", "Reval"], fam: "uralic", tz: 2, alt: ["Eesti"] },
  { id: "LV", n: "Latvia", fame: 4, cap: "Riga", capAlt: ["Rīga"], fam: "baltic", tz: 2, alt: ["Latvija"] },
  { id: "LT", n: "Lithuania", fame: 4, cap: "Vilnius", capAlt: ["Wilno"], fam: "baltic", tz: 2, alt: ["Lietuva"] },
  { id: "PL", n: "Poland", fame: 7, cap: "Warsaw", capAlt: ["Warszawa", "Varsovie", "Warschau", "Varsavia"], fam: "slavic", tz: 1, alt: ["Polska"] },
  { id: "CZ", n: "Czechia", fame: 6, cap: "Prague", capAlt: ["Praha", "Prag", "Praga"], fam: "slavic", tz: 1, alt: ["Czech Republic", "Česko", "Cesko", "Czechoslovakia"] },
  { id: "SK", n: "Slovakia", fame: 4, cap: "Bratislava", capAlt: ["Pressburg", "Pozsony"], fam: "slavic", tz: 1, alt: ["Slovensko", "Slovak Republic"] },
  { id: "HU", n: "Hungary", fame: 6, cap: "Budapest", capAlt: [], fam: "uralic", tz: 1, alt: ["Magyarország", "Magyarorszag"] },
  { id: "SI", n: "Slovenia", fame: 4, cap: "Ljubljana", capAlt: [], fam: "slavic", tz: 1, alt: ["Slovenija"] },
  { id: "HR", n: "Croatia", fame: 6, cap: "Zagreb", capAlt: [], fam: "slavic", tz: 1, alt: ["Hrvatska"] },
  { id: "BA", n: "Bosnia and Herzegovina", fame: 3, cap: "Sarajevo", capAlt: [], fam: "slavic", tz: 1, alt: ["Bosnia", "Bosnia-Herzegovina", "Bosnia Herzegovina", "BiH", "Bosna i Hercegovina"] },
  { id: "RS", n: "Serbia", fame: 4, cap: "Belgrade", capAlt: ["Beograd"], fam: "slavic", tz: 1, alt: ["Srbija"] },
  { id: "ME", n: "Montenegro", fame: 3, cap: "Podgorica", capAlt: [], fam: "slavic", tz: 1, alt: ["Crna Gora"] },
  { id: "XK", n: "Kosovo", fame: 2, cap: "Pristina", capAlt: ["Prishtina", "Priština", "Prishtinë"], fam: "albanian", tz: 1, alt: ["Kosova"] },
  { id: "AL", n: "Albania", fame: 3, cap: "Tirana", capAlt: ["Tiranë"], fam: "albanian", tz: 1, alt: ["Shqipëria", "Shqiperia"] },
  { id: "MK", n: "North Macedonia", fame: 2, cap: "Skopje", capAlt: [], fam: "slavic", tz: 1, alt: ["Macedonia", "FYROM", "Severna Makedonija"] },
  { id: "GR", n: "Greece", fame: 8, cap: "Athens", capAlt: ["Athina", "Athína", "Athènes", "Atene", "Athen"], fam: "greek", tz: 2, alt: ["Hellas", "Ellada", "Ellas"] },
  { id: "BG", n: "Bulgaria", fame: 4, cap: "Sofia", capAlt: ["Sofiya"], fam: "slavic", tz: 2, alt: ["Bulgariya", "Balgariya"] },
  { id: "RO", n: "Romania", fame: 5, cap: "Bucharest", capAlt: ["București", "Bucuresti", "Bukarest", "Bucarest"], fam: "romance", tz: 2, alt: ["România"] },
  { id: "MD", n: "Moldova", fame: 2, cap: "Chișinău", capAlt: ["Chisinau", "Kishinev", "Chişinău"], fam: "romance", tz: 2, alt: ["Republic of Moldova", "Moldavia"] },
  { id: "UA", n: "Ukraine", fame: 7, cap: "Kyiv", capAlt: ["Kiev", "Kyyiv", "Kijów"], fam: "slavic", tz: 2, the: 0, alt: ["The Ukraine", "Ukraina"] },
  { id: "BY", n: "Belarus", fame: 3, cap: "Minsk", capAlt: [], fam: "slavic", tz: 3, alt: ["Byelorussia", "Belorussia", "White Russia", "Bielorussia"] },
  { id: "RU", n: "Russia", fame: 8, cap: "Moscow", capAlt: ["Moskva", "Moskau", "Moscou", "Mosca"], fam: "slavic", tz: 3, alt: ["Russian Federation", "Rossiya", "Soviet Union", "USSR"] },
  { id: "TR", n: "Türkiye", fame: 6, cap: "Ankara", capAlt: [], fam: "turkic", tz: 3, alt: ["Turkey", "Turkiye"] },
  { id: "CY", n: "Cyprus", fame: 4, cap: "Nicosia", capAlt: ["Lefkosia", "Lefkoşa"], fam: "greek", tz: 2, alt: ["Kypros", "Kıbrıs"] },
  { id: "MT", n: "Malta", fame: 5, cap: "Valletta", capAlt: ["Valetta"], fam: "semitic", tz: 1, alt: [] },
  { id: "AD", n: "Andorra", fame: 3, cap: "Andorra la Vella", capAlt: ["Andorra-la-Vella"], fam: "romance", tz: 1, alt: [] },
  { id: "MC", n: "Monaco", fame: 4, cap: "Monaco", capAlt: ["Monaco City", "Monaco-Ville", "Monte Carlo"], fam: "romance", tz: 1, alt: [] },
  { id: "SM", n: "San Marino", fame: 2, cap: "San Marino", capAlt: ["City of San Marino"], fam: "romance", tz: 1, alt: [] },
  { id: "VA", n: "Vatican City", fame: 4, cap: "Vatican City", capAlt: ["Vatican", "Città del Vaticano"], fam: "romance", tz: 1, alt: ["Vatican", "Holy See", "The Vatican"] },
  { id: "LI", n: "Liechtenstein", fame: 3, cap: "Vaduz", capAlt: [], fam: "germanic", tz: 1, alt: [] },
  { id: "GE", n: "Georgia", fame: 3, cap: "Tbilisi", capAlt: ["Tiflis"], fam: "kartvelian", tz: 4, alt: ["Sakartvelo"] },
  { id: "AM", n: "Armenia", fame: 2, cap: "Yerevan", capAlt: ["Erevan", "Jerevan"], fam: "armenian", tz: 4, alt: ["Hayastan"] },
  { id: "AZ", n: "Azerbaijan", fame: 2, cap: "Baku", capAlt: ["Bakı", "Baki"], fam: "turkic", tz: 4, alt: ["Azerbaycan"] },
];

// Memberships and features (ids). Checked November 2026.
export const SETS = {
  eu: "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE",
  // Euro: the 21 euro-area members (Bulgaria joined on 1 January 2026) plus six other countries that use it.
  euro: "AT BE BG HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES AD MC SM VA ME XK",
  nato: "AL BE BG HR CZ DK EE FI FR DE GR HU IS IT LV LT LU ME NL MK NO PL PT RO SK SI ES SE TR GB",
  schengen: "AT BE BG HR CZ DK EE FI FR DE GR HU IS IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE CH",
  monarchy: "GB ES BE NL LU DK NO SE MC LI AD VA",
  yugo: "SI HR BA RS ME MK XK",
  ussr: "EE LV LT BY UA MD RU GE AM AZ",
  alps: "FR MC IT CH LI DE AT SI",
  danube: "DE AT SK HU HR RS RO BG MD UA",
  rhine: "CH LI AT DE FR NL",
  med: "ES FR MC IT MT SI HR BA ME AL GR TR CY",
  baltic: "DK DE PL LT LV EE FI SE RU",
  black: "BG RO UA RU GE TR",
  northsea: "GB NO DK DE NL BE FR",
  adriatic: "IT SI HR BA ME AL",
  islands: "IS IE GB MT CY",
  left: "GB IE MT CY",
  eet: "FI EE LV LT UA MD RO BG GR CY",
};

// Currencies other than the euro.
export const CURRENCY = { IS: "Króna", GB: "Pound sterling", DK: "Krone", NO: "Krone", SE: "Krona", CH: "Swiss franc", LI: "Swiss franc",
  PL: "Złoty", CZ: "Koruna", HU: "Forint", RO: "Leu", BA: "Convertible mark", RS: "Dinar", AL: "Lek", MK: "Denar", MD: "Leu",
  UA: "Hryvnia", BY: "Rouble", RU: "Rouble", TR: "Lira", GE: "Lari", AM: "Dram", AZ: "Manat" };

// Parts of countries people often type as if they were countries.
export const PARTS = {
  England: "GB", Scotland: "GB", Wales: "GB", "Northern Ireland": "GB", "Isle of Man": "GB", Jersey: "GB", Guernsey: "GB", Gibraltar: "GB",
  "Faroe Islands": "DK", Faroes: "DK", Greenland: "DK", "Åland": "FI", Aland: "FI", Catalonia: "ES", "Basque Country": "ES",
  Sardinia: "IT", Sicily: "IT", Corsica: "FR", Transnistria: "MD", Crimea: "UA", "Northern Cyprus": "CY", Flanders: "BE", Wallonia: "BE",
  Bavaria: "DE", Prussia: "DE", Bohemia: "CZ", Moravia: "CZ", Lapland: "FI", Svalbard: "NO", Madeira: "PT", Azores: "PT", "Canary Islands": "ES",
};

// Capitals of those parts, so "Edinburgh" gets a helpful message rather than "not a place".
export const PART_CAPITALS = { Edinburgh: "Scotland", Cardiff: "Wales", Belfast: "Northern Ireland", "Tórshavn": "the Faroe Islands",
  Torshavn: "the Faroe Islands", Douglas: "the Isle of Man", "St Helier": "Jersey", "St Peter Port": "Guernsey", Mariehamn: "Åland",
  Nuuk: "Greenland", Barcelona: "Catalonia", Tiraspol: "Transnistria", Sukhumi: "Abkhazia", Stepanakert: "Nagorno-Karabakh" };

// Non-European countries people might reasonably type, beyond the full world list built in.
export const NOT_EUROPE_NOTE = { KZ: "Kazakhstan has a little land west of the Ural River, but it isn't counted as European here.",
  IL: "Israel takes part in Eurovision and UEFA, but it isn't counted as a European country here." };
