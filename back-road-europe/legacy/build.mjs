import fs from "node:fs";
import { mesh, merge, feature } from "topojson-client";
import { geoConicConformal, geoPath, geoGraticule } from "d3-geo";

const dir = new URL(".", import.meta.url).pathname;
const topo = JSON.parse(fs.readFileSync(dir + "node_modules/world-atlas/countries-50m.json", "utf8"));

const W = 1000, MX = 260, MY = 140;
const ring = [];
for (let lon = -24; lon <= 40; lon += 2) ring.push([lon, 35]);
for (let lat = 35; lat <= 70.5; lat += 2) ring.push([40, lat]);
for (let lon = 40; lon >= -24; lon -= 2) ring.push([lon, 70.5]);
for (let lat = 70.5; lat >= 35; lat -= 2) ring.push([-24, lat]);
const box = { type: "MultiPoint", coordinates: ring };

const proj = geoConicConformal().parallels([43, 62]).rotate([-10, 0]).center([0, 52]);
proj.fitWidth(W, box);
const b = geoPath(proj).bounds(box);
const H = Math.ceil(b[1][1] - b[0][1]);
proj.fitExtent([[0, 0], [W, H]], box);
proj.clipExtent([[-MX, -MY], [W + MX, H + MY]]);
const path = geoPath(proj).digits(1);

const land = path(merge(topo, topo.objects.countries.geometries));
const borders = path(mesh(topo, topo.objects.countries, (a, c) => a !== c));
const grat = path(geoGraticule().step([10, 10])());
const P = (lon, lat) => proj([lon, lat]).map(v => Math.round(v * 10) / 10);
const at = (lat, lon) => { const [x, y] = P(lon, lat); return { lat, lon, x, y }; };

const seas = [
  ["Atlantic Ocean", -17, 46], ["North Sea", 3, 56.3], ["Norwegian Sea", 3, 66.5], ["Baltic Sea", 19.3, 56.6],
  ["Mediterranean Sea", 5.5, 38], ["Black Sea", 34, 43.3], ["Bay of Biscay", -5, 45.3],
].map(([t, lon, lat]) => { const [x, y] = P(lon, lat); return { t, x, y }; });

// id, name, capital, lat, lon, currency, area (thousand km²), population (millions), neighbours, capital's river, [second river], [takes "the"]
const C = [
  ["IS", "Iceland", "Reykjavík", 64.15, -21.94, "Króna", 103, 0.39, ""],
  ["IE", "Ireland", "Dublin", 53.35, -6.26, "Euro", 70, 5.3, "GB", "Liffey"],
  ["GB", "United Kingdom", "London", 51.51, -0.13, "Pound sterling", 244, 68, "IE", "Thames", "", 1],
  ["PT", "Portugal", "Lisbon", 38.72, -9.14, "Euro", 92, 10.5, "ES", "Tagus"],
  ["ES", "Spain", "Madrid", 40.42, -3.70, "Euro", 506, 48, "PT FR AD", "Manzanares"],
  ["FR", "France", "Paris", 48.86, 2.35, "Euro", 551, 68, "ES AD MC IT CH DE LU BE", "Seine"],
  ["BE", "Belgium", "Brussels", 50.85, 4.35, "Euro", 31, 11.8, "FR LU DE NL", "Senne"],
  ["NL", "Netherlands", "Amsterdam", 52.37, 4.90, "Euro", 42, 17.9, "BE DE", "Amstel", "", 1],
  ["LU", "Luxembourg", "Luxembourg City", 49.61, 6.13, "Euro", 2.6, 0.67, "FR BE DE", "Alzette"],
  ["DE", "Germany", "Berlin", 52.52, 13.40, "Euro", 358, 83.5, "DK PL CZ AT CH FR LU BE NL", "Spree"],
  ["CH", "Switzerland", "Bern", 46.95, 7.45, "Swiss franc", 41, 8.9, "DE FR IT AT LI", "Aare"],
  ["AT", "Austria", "Vienna", 48.21, 16.37, "Euro", 84, 9.1, "DE CZ SK HU SI IT CH LI", "Danube"],
  ["IT", "Italy", "Rome", 41.90, 12.48, "Euro", 301, 59, "FR CH AT SI SM VA", "Tiber"],
  ["DK", "Denmark", "Copenhagen", 55.68, 12.57, "Krone", 43, 5.9, "DE"],
  ["NO", "Norway", "Oslo", 59.91, 10.75, "Krone", 385, 5.5, "SE FI RU", "Akerselva"],
  ["SE", "Sweden", "Stockholm", 59.33, 18.07, "Krona", 450, 10.5, "NO FI"],
  ["FI", "Finland", "Helsinki", 60.17, 24.94, "Euro", 338, 5.6, "SE NO RU"],
  ["EE", "Estonia", "Tallinn", 59.44, 24.75, "Euro", 45, 1.4, "LV RU"],
  ["LV", "Latvia", "Riga", 56.95, 24.11, "Euro", 65, 1.9, "EE LT RU BY", "Daugava"],
  ["LT", "Lithuania", "Vilnius", 54.69, 25.28, "Euro", 65, 2.9, "LV BY PL RU", "Neris"],
  ["PL", "Poland", "Warsaw", 52.23, 21.01, "Złoty", 313, 37, "DE CZ SK UA BY LT RU", "Vistula"],
  ["CZ", "Czechia", "Prague", 50.08, 14.44, "Koruna", 79, 10.9, "DE PL SK AT", "Vltava"],
  ["SK", "Slovakia", "Bratislava", 48.15, 17.11, "Euro", 49, 5.4, "CZ PL UA HU AT", "Danube"],
  ["HU", "Hungary", "Budapest", 47.50, 19.04, "Forint", 93, 9.6, "AT SK UA RO RS HR SI", "Danube"],
  ["SI", "Slovenia", "Ljubljana", 46.06, 14.51, "Euro", 20, 2.1, "IT AT HU HR"],
  ["HR", "Croatia", "Zagreb", 45.81, 15.98, "Euro", 57, 3.9, "SI HU RS BA ME", "Sava"],
  ["BA", "Bosnia and Herzegovina", "Sarajevo", 43.86, 18.41, "Convertible mark", 51, 3.2, "HR RS ME", "Miljacka"],
  ["RS", "Serbia", "Belgrade", 44.79, 20.45, "Dinar", 77, 6.6, "HU RO BG MK XK ME BA HR", "Danube", "Sava"],
  ["ME", "Montenegro", "Podgorica", 42.44, 19.26, "Euro", 13.8, 0.62, "HR BA RS XK AL", "Morača"],
  ["XK", "Kosovo", "Pristina", 42.66, 21.17, "Euro", 10.9, 1.6, "RS ME AL MK"],
  ["AL", "Albania", "Tirana", 41.33, 19.82, "Lek", 28.7, 2.8, "ME XK MK GR"],
  ["MK", "North Macedonia", "Skopje", 42.00, 21.43, "Denar", 25.7, 1.8, "XK RS BG GR AL", "Vardar"],
  ["GR", "Greece", "Athens", 37.98, 23.73, "Euro", 132, 10.4, "AL MK BG TR"],
  ["BG", "Bulgaria", "Sofia", 42.70, 23.32, "Euro", 111, 6.4, "RO RS MK GR TR"],
  ["RO", "Romania", "Bucharest", 44.43, 26.10, "Leu", 238, 19, "HU UA MD BG RS", "Dâmbovița"],
  ["MD", "Moldova", "Chișinău", 47.01, 28.86, "Leu", 33.8, 2.5, "RO UA"],
  ["UA", "Ukraine", "Kyiv", 50.45, 30.52, "Hryvnia", 604, 38, "PL SK HU RO MD BY RU", "Dnieper"],
  ["BY", "Belarus", "Minsk", 53.90, 27.56, "Rouble", 208, 9.2, "PL LT LV RU UA", "Svislach"],
  ["RU", "Russia", "Moscow", 55.75, 37.62, "Rouble", 17098, 144, "NO FI EE LV LT PL BY UA"],
  ["TR", "Türkiye", "Ankara", 39.93, 32.86, "Lira", 784, 85, "GR BG"],
  ["CY", "Cyprus", "Nicosia", 35.19, 33.38, "Euro", 9.3, 1.3, ""],
  ["MT", "Malta", "Valletta", 35.90, 14.51, "Euro", 0.32, 0.54, ""],
  ["AD", "Andorra", "Andorra la Vella", 42.51, 1.52, "Euro", 0.47, 0.08, "FR ES"],
  ["MC", "Monaco", "Monaco", 43.74, 7.42, "Euro", 0.002, 0.04, "FR"],
  ["SM", "San Marino", "San Marino", 43.94, 12.45, "Euro", 0.061, 0.034, "IT"],
  ["VA", "Vatican City", "Vatican City", 41.90, 12.45, "Euro", 0.0005, 0.0008, "IT"],
  ["LI", "Liechtenstein", "Vaduz", 47.14, 9.52, "Swiss franc", 0.16, 0.04, "CH AT"],
].map(([id, n, cap, lat, lon, cur, area, pop, nb, r, alt, the]) => ({ id, n, cap, ...at(lat, lon), cur, area, pop, nb: nb ? nb.split(" ") : [], r: r || "", alt: alt || "", the: the || 0 }));

const ids = new Set(C.map(c => c.id));
for (const c of C) for (const n of c.nb) {
  if (!ids.has(n)) throw new Error(`unknown neighbour ${n} of ${c.id}`);
  if (!C.find(x => x.id === n).nb.includes(c.id)) throw new Error(`border not mutual: ${c.id}-${n}`);
}

// city, country, lat, lon, river, [second river]
const T = [
  ["Glasgow", "GB", 55.86, -4.25, "Clyde"], ["Newcastle upon Tyne", "GB", 54.98, -1.61], ["Liverpool", "GB", 53.41, -2.98, "Mersey"],
  ["Belfast", "GB", 54.60, -5.93, "Lagan"], ["Cardiff", "GB", 51.48, -3.18, "Taff"], ["Aberdeen", "GB", 57.15, -2.09, "Dee"],
  ["Edinburgh", "GB", 55.95, -3.19], ["Manchester", "GB", 53.48, -2.24], ["Inverness", "GB", 57.48, -4.22], ["York", "GB", 53.96, -1.08, "Ouse"], ["Bristol", "GB", 51.45, -2.59, "Avon"],
  ["Cork", "IE", 51.90, -8.47, "Lee"], ["Limerick", "IE", 52.66, -8.63, "Shannon"], ["Galway", "IE", 53.27, -9.05, "Corrib"],
  ["Kilkenny", "IE", 52.65, -7.25, "Nore"], ["Waterford", "IE", 52.26, -7.11, "Suir"], ["Sligo", "IE", 54.27, -8.47, "Garavogue"], ["Drogheda", "IE", 53.72, -6.35, "Boyne"],
  ["Lyon", "FR", 45.76, 4.84, "Rhône", "Saône"], ["Bordeaux", "FR", 44.84, -0.58, "Garonne"], ["Nantes", "FR", 47.22, -1.55, "Loire"], ["Toulouse", "FR", 43.60, 1.44, "Garonne"],
  ["Marseille", "FR", 43.30, 5.37], ["Nice", "FR", 43.70, 7.27], ["Lille", "FR", 50.63, 3.06], ["Strasbourg", "FR", 48.57, 7.75], ["Rouen", "FR", 49.44, 1.10, "Seine"],
  ["Barcelona", "ES", 41.39, 2.17], ["Seville", "ES", 37.39, -5.98, "Guadalquivir"], ["Zaragoza", "ES", 41.65, -0.89, "Ebro"], ["Valencia", "ES", 39.47, -0.38, "Turia"],
  ["Bilbao", "ES", 43.26, -2.93, "Nervión"], ["Granada", "ES", 37.18, -3.60], ["Toledo", "ES", 39.86, -4.02, "Tagus"], ["Salamanca", "ES", 40.97, -5.66, "Tormes"],
  ["Porto", "PT", 41.15, -8.61, "Douro"], ["Coimbra", "PT", 40.21, -8.43, "Mondego"], ["Faro", "PT", 37.02, -7.93],
  ["Milan", "IT", 45.46, 9.19], ["Naples", "IT", 40.85, 14.27], ["Florence", "IT", 43.77, 11.26, "Arno"], ["Turin", "IT", 45.07, 7.69, "Po"], ["Venice", "IT", 45.44, 12.32],
  ["Verona", "IT", 45.44, 10.99, "Adige"], ["Bologna", "IT", 44.49, 11.34], ["Palermo", "IT", 38.12, 13.36], ["Pisa", "IT", 43.72, 10.40, "Arno"],
  ["Hamburg", "DE", 53.55, 9.99, "Elbe"], ["Munich", "DE", 48.14, 11.58, "Isar"], ["Cologne", "DE", 50.94, 6.96, "Rhine"], ["Frankfurt", "DE", 50.11, 8.68, "Main"],
  ["Dresden", "DE", 51.05, 13.74, "Elbe"], ["Bremen", "DE", 53.08, 8.80, "Weser"], ["Stuttgart", "DE", 48.78, 9.18, "Neckar"], ["Leipzig", "DE", 51.34, 12.37],
  ["Regensburg", "DE", 49.02, 12.10, "Danube"], ["Heidelberg", "DE", 49.40, 8.69, "Neckar"],
  ["Rotterdam", "NL", 51.92, 4.48], ["Utrecht", "NL", 52.09, 5.12], ["Maastricht", "NL", 50.85, 5.69, "Meuse"], ["Eindhoven", "NL", 51.44, 5.47],
  ["Antwerp", "BE", 51.22, 4.40, "Scheldt"], ["Bruges", "BE", 51.21, 3.22], ["Ghent", "BE", 51.05, 3.72], ["Liège", "BE", 50.63, 5.57, "Meuse"],
  ["Zurich", "CH", 47.37, 8.54, "Limmat"], ["Geneva", "CH", 46.20, 6.14, "Rhône"], ["Basel", "CH", 47.56, 7.59, "Rhine"], ["Lausanne", "CH", 46.52, 6.63], ["Lucerne", "CH", 47.05, 8.31, "Reuss"],
  ["Salzburg", "AT", 47.80, 13.04, "Salzach"], ["Innsbruck", "AT", 47.27, 11.40], ["Graz", "AT", 47.07, 15.44, "Mur"], ["Linz", "AT", 48.31, 14.29, "Danube"],
  ["Aarhus", "DK", 56.16, 10.20], ["Odense", "DK", 55.40, 10.39],
  ["Bergen", "NO", 60.39, 5.32], ["Trondheim", "NO", 63.43, 10.40, "Nidelva"], ["Tromsø", "NO", 69.65, 18.96], ["Stavanger", "NO", 58.97, 5.73],
  ["Gothenburg", "SE", 57.71, 11.97, "Göta älv"], ["Malmö", "SE", 55.60, 13.00], ["Uppsala", "SE", 59.86, 17.64], ["Kiruna", "SE", 67.86, 20.23],
  ["Turku", "FI", 60.45, 22.27, "Aura"], ["Tampere", "FI", 61.50, 23.76], ["Rovaniemi", "FI", 66.50, 25.73], ["Oulu", "FI", 65.01, 25.47],
  ["Akureyri", "IS", 65.68, -18.09], ["Tartu", "EE", 58.38, 26.72, "Emajõgi"], ["Daugavpils", "LV", 55.87, 26.54], ["Kaunas", "LT", 54.90, 23.90, "Nemunas"], ["Klaipėda", "LT", 55.71, 21.13],
  ["Kraków", "PL", 50.06, 19.94, "Vistula"], ["Gdańsk", "PL", 54.35, 18.65], ["Wrocław", "PL", 51.11, 17.04, "Oder"], ["Poznań", "PL", 52.41, 16.93, "Warta"], ["Łódź", "PL", 51.76, 19.46], ["Szczecin", "PL", 53.43, 14.55, "Oder"],
  ["Brno", "CZ", 49.20, 16.61], ["Ostrava", "CZ", 49.82, 18.26], ["Plzeň", "CZ", 49.75, 13.38], ["Košice", "SK", 48.72, 21.26],
  ["Debrecen", "HU", 47.53, 21.63], ["Szeged", "HU", 46.25, 20.15, "Tisza"], ["Pécs", "HU", 46.07, 18.23], ["Maribor", "SI", 46.55, 15.65, "Drava"],
  ["Split", "HR", 43.51, 16.44], ["Dubrovnik", "HR", 42.65, 18.09], ["Rijeka", "HR", 45.33, 14.44], ["Osijek", "HR", 45.55, 18.69, "Drava"],
  ["Mostar", "BA", 43.34, 17.81, "Neretva"], ["Banja Luka", "BA", 44.77, 17.19, "Vrbas"], ["Novi Sad", "RS", 45.27, 19.83, "Danube"], ["Niš", "RS", 43.32, 21.90],
  ["Kotor", "ME", 42.42, 18.77], ["Prizren", "XK", 42.21, 20.74], ["Shkodër", "AL", 42.07, 19.51], ["Durrës", "AL", 41.32, 19.45], ["Ohrid", "MK", 41.12, 20.80], ["Bitola", "MK", 41.03, 21.33],
  ["Thessaloniki", "GR", 40.64, 22.94], ["Patras", "GR", 38.25, 21.73], ["Heraklion", "GR", 35.34, 25.13],
  ["Plovdiv", "BG", 42.14, 24.75, "Maritsa"], ["Varna", "BG", 43.21, 27.91], ["Burgas", "BG", 42.50, 27.47],
  ["Cluj-Napoca", "RO", 46.77, 23.59], ["Timișoara", "RO", 45.76, 21.23], ["Iași", "RO", 47.16, 27.59], ["Constanța", "RO", 44.17, 28.63], ["Brașov", "RO", 45.65, 25.61],
  ["Tiraspol", "MD", 46.84, 29.63, "Dniester"], ["Lviv", "UA", 49.84, 24.03], ["Odesa", "UA", 46.48, 30.72], ["Kharkiv", "UA", 49.99, 36.23], ["Dnipro", "UA", 48.46, 35.05],
  ["Gomel", "BY", 52.43, 31.00, "Sozh"], ["Grodno", "BY", 53.68, 23.83],
  ["St Petersburg", "RU", 59.94, 30.31, "Neva"], ["Kaliningrad", "RU", 54.71, 20.51, "Pregolya"], ["Murmansk", "RU", 68.97, 33.07], ["Smolensk", "RU", 54.78, 32.05, "Dnieper"],
  ["Istanbul", "TR", 41.01, 28.98], ["Izmir", "TR", 38.42, 27.14], ["Bursa", "TR", 40.19, 29.06], ["Edirne", "TR", 41.68, 26.56], ["Mdina", "MT", 35.89, 14.40],
].map(([p, id, lat, lon, r, alt]) => { if (!ids.has(id)) throw new Error(p); return { p, id, ...at(lat, lon), r: r || "", alt: alt || "" }; });

// place, country, lat, lon, question, answer, wrong answers, fact
const Hd = [
  ["Stockholm", "Sweden", 59.33, 18.07, "Which country has more islands than any other in the world?", "Sweden", ["Norway", "Finland", "Greece"], "Sweden counts well over 200,000 islands; Stockholm alone is spread across 14."],
  ["Rome", "Italy", 41.90, 12.48, "The world's smallest country lies entirely inside which city?", "Rome", ["Nice", "Geneva", "Athens"], "Vatican City covers under half a square kilometre of Rome."],
  ["Vienna", "Austria", 48.21, 16.37, "How many countries does the Danube flow through or along?", "10", ["6", "8", "12"], "No other river in the world touches as many countries."],
  ["Chamonix", "France", 45.92, 6.87, "Which is the highest mountain in the Alps?", "Mont Blanc", ["Matterhorn", "Monte Rosa", "Eiger"], "Mont Blanc stands at roughly 4,806 m above the town of Chamonix."],
  ["Vaduz", "Liechtenstein", 47.14, 9.52, "Which European country is doubly landlocked, with every neighbour landlocked too?", "Liechtenstein", ["Andorra", "Luxembourg", "San Marino"], "Its only neighbours are Switzerland and Austria."],
  ["Istanbul", "Türkiye", 41.01, 28.98, "Which strait divides Istanbul between Europe and Asia?", "Bosphorus", ["Dardanelles", "Strait of Messina", "Kerch Strait"], "The Bosphorus links the Black Sea to the Sea of Marmara."],
  ["Valletta", "Malta", 35.90, 14.51, "Which is the smallest capital city in the EU?", "Valletta", ["Luxembourg City", "Ljubljana", "Nicosia"], "Valletta was built by the Knights of St John after the siege of 1565."],
  ["Gibraltar", "British territory", 36.14, -5.35, "How wide is the Strait of Gibraltar at its narrowest?", "About 13 km", ["About 3 km", "About 40 km", "About 90 km"], "On a clear day Morocco's Rif mountains are easy to pick out from the Rock."],
  ["Palermo", "Italy", 38.12, 13.36, "Which is the largest island in the Mediterranean?", "Sicily", ["Sardinia", "Corsica", "Crete"], "Sicily is just ahead of Sardinia in area."],
  ["Zagreb", "Croatia", 45.81, 15.98, "Croatia is the EU's newest member state. In which year did it join?", "2013", ["2004", "2007", "2019"], "Croatia became the 28th member; the UK has since left."],
  ["Strasbourg", "France", 48.57, 7.75, "In which city is the official seat of the European Parliament?", "Strasbourg", ["Brussels", "Luxembourg City", "The Hague"], "Most committee work happens in Brussels, but the seat is Strasbourg."],
  ["Catania", "Italy", 37.50, 15.09, "Which is Europe's most active volcano?", "Etna", ["Vesuvius", "Stromboli", "Hekla"], "Etna rises over 3,300 m above Catania and erupts most years."],
  ["Brussels", "Belgium", 50.85, 4.35, "How many stars are on the flag of Europe?", "12", ["10", "15", "27"], "The number has never tracked membership; twelve stands for completeness."],
  ["Reykjavík", "Iceland", 64.15, -21.94, "Which is the world's northernmost capital of a sovereign state?", "Reykjavík", ["Oslo", "Helsinki", "Tallinn"], "Reykjavík lies at about 64° north, just below the Arctic Circle."],
  ["Bergen", "Norway", 60.39, 5.32, "Which is Norway's longest fjord?", "Sognefjord", ["Geirangerfjord", "Hardangerfjord", "Lysefjord"], "The Sognefjord runs about 205 km inland, north of Bergen."],
  ["Budapest", "Hungary", 47.50, 19.04, "Hungarian is distantly related to which of these languages?", "Finnish", ["Romanian", "Slovak", "German"], "Hungarian, Finnish and Estonian are all Uralic languages."],
  ["St Petersburg", "Russia", 59.94, 30.31, "Which is the largest lake in Europe?", "Ladoga", ["Onega", "Peipus", "Vänern"], "Lake Ladoga, just east of St Petersburg, covers around 17,700 km²."],
  ["Andorra la Vella", "Andorra", 42.51, 1.52, "At over 1,000 m, which is the highest capital city in Europe?", "Andorra la Vella", ["Bern", "Madrid", "Sarajevo"], "Andorra's heads of state are the French president and a Spanish bishop."],
  ["Venice", "Italy", 45.44, 12.32, "Venice sits in a lagoon at the head of which sea?", "Adriatic Sea", ["Tyrrhenian Sea", "Ionian Sea", "Ligurian Sea"], "Split and Dubrovnik face the same sea from the other shore."],
  ["Calais", "France", 50.95, 1.86, "The Channel Tunnel links Folkestone in England with a terminal beside which French port?", "Calais", ["Dunkirk", "Le Havre", "Dieppe"], "The tunnel runs for about 50 km, most of it under the sea."],
  ["Copenhagen", "Denmark", 55.68, 12.57, "The Øresund Bridge links Malmö in Sweden with which capital?", "Copenhagen", ["Oslo", "Helsinki", "Stockholm"], "The crossing turns into a tunnel partway over, via an artificial island."],
  ["Sofia", "Bulgaria", 42.70, 23.32, "Which country swapped the lev for the euro in January 2026?", "Bulgaria", ["Romania", "Hungary", "Czechia"], "Bulgaria became the 21st member of the euro area."],
  ["Cabo da Roca", "Portugal", 38.78, -9.50, "What is the westernmost point of mainland Europe?", "Cabo da Roca", ["Cape Finisterre", "Cape St Vincent", "Land's End"], "A lighthouse marks the spot, 140 m above the Atlantic near Lisbon."],
  ["Schengen", "Luxembourg", 49.47, 6.36, "Schengen, the village that gave Europe's border-free area its name, is in which country?", "Luxembourg", ["Belgium", "France", "Germany"], "The agreement was signed on a river boat there in 1985, where three countries meet."],
  ["Santiago de Compostela", "Spain", 42.88, -8.54, "The Camino de Santiago ends in which region of Spain?", "Galicia", ["Asturias", "Basque Country", "Castile and León"], "The most popular route, the Camino Francés, is about 780 km long."],
  ["Koper", "Slovenia", 45.55, 13.73, "How long is Slovenia's coastline?", "About 47 km", ["About 5 km", "About 180 km", "About 420 km"], "Koper is its main port, squeezed between the Italian and Croatian coasts."],
  ["Inverness", "Scotland", 57.48, -4.22, "Which touring route starts and ends at Inverness Castle?", "North Coast 500", ["Wild Atlantic Way", "Causeway Coastal Route", "Atlantic Highway"], "It loops roughly 500 miles round the northern Highlands."],
  ["Bormio", "Italy", 46.47, 10.37, "Which Alpine pass above Bormio is famous for the 48 hairpins on its far side?", "Stelvio", ["Brenner", "Great St Bernard", "Furka"], "The Stelvio tops out at 2,757 m."],
  ["Sibiu", "Romania", 45.80, 24.15, "Romania's Transfăgărășan road crosses which mountain range?", "Carpathians", ["Balkan Mountains", "Dinaric Alps", "Rhodopes"], "The road climbs to 2,042 m in the Făgăraș mountains, south of Sibiu."],
  ["Füssen", "Germany", 47.57, 10.70, "Germany's Romantic Road ends at Füssen, beneath which castle?", "Neuschwanstein", ["Hohenzollern", "Heidelberg", "Wartburg"], "Ludwig II of Bavaria began building it in 1869."],
  ["Kinsale", "Ireland", 51.71, -8.52, "Kinsale in County Cork is the southern end of which coastal route?", "Wild Atlantic Way", ["Ring of Kerry", "Copper Coast", "Causeway Coastal Route"], "It runs about 2,500 km north to the Inishowen peninsula in Donegal."],
  ["Athens", "Greece", 37.98, 23.73, "Which temple crowns the Acropolis in Athens?", "Parthenon", ["Pantheon", "Temple of Hephaestus", "Temple of Poseidon"], "It was finished in 432 BC and dedicated to Athena."],
  ["Amsterdam", "Netherlands", 52.37, 4.90, "Roughly how much of the Netherlands lies below sea level?", "About a quarter", ["About a twentieth", "About half", "About three quarters"], "Schiphol airport sits on the bed of a drained lake."],
  ["Tallinn", "Estonia", 59.44, 24.75, "Which capital lies about 80 km from Tallinn, across the Gulf of Finland?", "Helsinki", ["Stockholm", "Riga", "Oslo"], "Ferries make the crossing in about two hours."],
  ["Dubrovnik", "Croatia", 42.65, 18.09, "A short strip of which country's coast separates Dubrovnik from the rest of Croatia?", "Bosnia and Herzegovina", ["Montenegro", "Albania", "Slovenia"], "The Pelješac Bridge, opened in 2022, now bypasses it."],
  ["Edinburgh", "Scotland", 55.95, -3.19, "What is the rock beneath Edinburgh Castle?", "An extinct volcano", ["A chalk cliff", "A glacial moraine", "A man-made mound"], "Castle Rock is a volcanic plug around 350 million years old."],
  ["Constanța", "Romania", 44.17, 28.63, "The Danube ends its journey in which sea?", "Black Sea", ["Caspian Sea", "Aegean Sea", "Adriatic Sea"], "It reaches the sea through a delta north of the port of Constanța."],
  ["Limerick", "Ireland", 52.66, -8.63, "Which is the longest river in Ireland?", "Shannon", ["Barrow", "Blackwater", "Boyne"], "The Shannon runs about 360 km from Cavan, through Limerick, to the Atlantic."],
  ["Berlin", "Germany", 52.52, 13.40, "Which EU country has the largest population?", "Germany", ["France", "Italy", "Spain"], "About 83 million people live in Germany."],
  ["Monaco", "Monaco", 43.74, 7.42, "Which is the most densely populated country in Europe?", "Monaco", ["Malta", "Netherlands", "Belgium"], "Around 39,000 people live on roughly two square kilometres."],
  ["Geneva", "Switzerland", 46.20, 6.14, "Which river flows out of Lake Geneva and on to the Mediterranean?", "Rhône", ["Rhine", "Saône", "Po"], "The Rhône enters the lake at its far, eastern end and leaves at Geneva."],
].map(([p, c, lat, lon, q, a, w, f]) => ({ p, c, ...at(lat, lon), q, a, w, f }));

const NE = { "Bosnia and Herz.": "BA", "Macedonia": "MK", "North Macedonia": "MK", "Vatican": "VA", "Turkey": "TR", "Czech Rep.": "CZ" };
const feats = feature(topo, topo.objects.countries).features, shapes = {}, noShape = [];
for (const c of C) { const f = feats.find(f => NE[f.properties.name] === c.id || f.properties.name === c.n); if (f) shapes[c.id] = path(f) || ""; else noShape.push(c.n); }
console.log({ noShape });
const data = { shapes, W, H, MX, MY, land, borders, grat, seas, start: { p: "Dublin", ...at(53.35, -6.26) }, c: C };
const off = [...C.map(c => ({ ...c, p: c.cap })), ...T, ...Hd].filter(q => q.x < -40 || q.x > W + 40 || q.y < -40 || q.y > H + 40).map(q => q.p);
let tpl = fs.readFileSync(dir + "template.html", "utf8");
tpl = tpl.slice(0, tpl.indexOf("<script>")).replace('<div class="dash">', '<div class="dash"><div class="tools"><button class="tool" id="help">How to play</button><button class="tool" id="stats">Record</button><button class="tool" id="mute"></button></div>').replace('aria-label="Kilometres earned"', 'aria-label="Points"').replace("</style>", () => fs.readFileSync(dir + "extra.css", "utf8") + "</style>").replace(/<p class="note">[\s\S]*?<\/p>/, '<p class="note" id="note"></p><form class="ask" id="rival" autocomplete="off"><input id="code" type="text" aria-label="A friend&#39;s result code" placeholder="Paste a friend&#39;s result code" spellcheck="false"><button class="go alt">Compare</button></form><p class="note" id="rmsg" aria-live="polite"></p>');
const js = (fs.readFileSync(dir + "curated.js", "utf8") + fs.readFileSync(dir + "game.js", "utf8")).replace("__DATA__", () => JSON.stringify(data));
tpl += '<dialog id="dlg"><div id="dlgBody"></div><div><button class="go" id="dlgClose">Close</button></div></dialog>\n';
fs.writeFileSync(dir + "../back-road-europe.html", tpl + "<script>\n" + js + "</script>\n");
console.log({ W, H, countries: C.length, cities: T.length, hand: Hd.length, offMap: off });
