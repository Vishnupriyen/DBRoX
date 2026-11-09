// Made-up full-size distributor for the working-app test: 2,000 products, 1,200 shops on 24 beats, 10 staff,
// opening stock as purchase bills. Deterministic (same files every run).   node e2e/live/make-data.cjs <outDir>
const XLSX = require('xlsx');
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'data'); fs.mkdirSync(OUT, { recursive: true });
let seed = 20261109; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

// category → HSN, GST %, typical MRP per base size, pieces per case
const CAT = {
  detergent: ['34022090', 18, 1, 12], soap: ['34011190', 5, 1, 72], shampoo: ['33051090', 5, 1, 48], paste: ['33061020', 5, 1, 72],
  tea: ['09024020', 5, 1, 40], coffee: ['21011120', 5, 1, 48], biscuit: ['19053100', 5, 1, 96], snack: ['21069099', 5, 1, 60],
  noodles: ['19023010', 5, 1, 96], sauce: ['21032000', 5, 1, 24], oil: ['33059011', 5, 1, 48], atta: ['11010000', 5, 1, 4],
  choco: ['18063100', 5, 1, 120], dish: ['34022090', 18, 1, 60], cream: ['33049910', 18, 1, 48], drink: ['19019090', 5, 1, 24],
  note: ['48202000', 18, 1, 24], spice: ['09109100', 5, 1, 120], ghee: ['04059020', 5, 1, 12], juice: ['20098990', 5, 1, 24],
};
// [company, brand, category, variants[], sizes [label, mrp][]]
const B = [
  ['Hindustan Unilever', 'Surf Excel', 'detergent', ['Easy Wash', 'Quick Wash', 'Matic Front Load', 'Matic Top Load', 'Liquid'], [['500g', 76], ['1kg', 140], ['2kg', 270], ['4kg', 520]]],
  ['Hindustan Unilever', 'Rin', 'detergent', ['Advanced', 'Bar', 'Liquid'], [['150g', 12], ['250g', 22], ['500g', 52], ['1kg', 98]]],
  ['Hindustan Unilever', 'Wheel', 'detergent', ['Active 2in1', 'Green', 'Bar'], [['500g', 40], ['1kg', 75], ['2kg', 145]]],
  ['Hindustan Unilever', 'Vim', 'dish', ['Bar', 'Liquid Lemon', 'Liquid Pudina', 'Anti Smell'], [['75g', 10], ['200g', 25], ['300g', 36], ['500ml', 115], ['750ml', 165]]],
  ['Hindustan Unilever', 'Lifebuoy', 'soap', ['Total 10', 'Lemon Fresh', 'Care', 'Neem', 'Handwash'], [['54g', 10], ['100g', 30], ['125g', 38], ['4x125g', 140]]],
  ['Hindustan Unilever', 'Lux', 'soap', ['Soft Rose', 'Jasmine', 'Velvet Glow', 'Sandal'], [['100g', 35], ['150g', 52], ['3x150g', 150]]],
  ['Hindustan Unilever', 'Dove', 'shampoo', ['Cream Beauty Bar', 'Intense Repair', 'Hair Fall Rescue', 'Daily Shine'], [['50g', 45], ['100g', 75], ['180ml', 199], ['340ml', 349]]],
  ['Hindustan Unilever', 'Clinic Plus', 'shampoo', ['Strong & Long', 'Natural Shine', 'Health'], [['Sachet 16pcs', 32], ['80ml', 55], ['175ml', 115], ['340ml', 210]]],
  ['Hindustan Unilever', 'Sunsilk', 'shampoo', ['Black Shine', 'Thick & Long', 'Lusciously Thick'], [['Sachet 16pcs', 32], ['80ml', 60], ['180ml', 140], ['340ml', 260]]],
  ['Hindustan Unilever', 'Close Up', 'paste', ['Red Hot', 'Lemon Mint', 'Everfresh'], [['20g', 10], ['80g', 50], ['150g', 92], ['2x150g', 170]]],
  ['Hindustan Unilever', 'Pepsodent', 'paste', ['Germicheck', 'Expert Protection', 'Whitening'], [['20g', 10], ['80g', 45], ['150g', 88]]],
  ['Hindustan Unilever', 'Red Label', 'tea', ['Leaf', 'Natural Care', 'Dust'], [['100g', 60], ['250g', 145], ['500g', 280], ['1kg', 540]]],
  ['Hindustan Unilever', 'Taj Mahal', 'tea', ['Leaf', 'Rich & Flavourful'], [['100g', 85], ['250g', 205], ['500g', 400]]],
  ['Hindustan Unilever', '3 Roses', 'tea', ['Dust', 'Natural Care'], [['100g', 52], ['250g', 125], ['500g', 245]]],
  ['Hindustan Unilever', 'Bru', 'coffee', ['Instant', 'Green Label', 'Gold'], [['Sachet 2g', 2], ['50g', 125], ['100g', 230], ['200g', 450]]],
  ['Hindustan Unilever', 'Kissan', 'sauce', ['Fresh Tomato Ketchup', 'Sweet & Spicy', 'Mixed Fruit Jam'], [['90g', 25], ['200g', 55], ['500g', 125], ['1kg', 220]]],
  ['Hindustan Unilever', 'Knorr', 'noodles', ['Hot & Sour Soup', 'Tomato Soup', 'Sweet Corn Soup', 'Chicken Soup'], [['43g', 55], ['Pack of 4', 210]]],
  ['Hindustan Unilever', 'Horlicks', 'drink', ['Classic Malt', 'Chocolate', 'Women\'s Plus', 'Junior'], [['200g', 120], ['500g', 280], ['1kg', 520]]],
  ['Hindustan Unilever', 'Boost', 'drink', ['Classic', 'Chocolate'], [['200g', 125], ['500g', 290], ['1kg', 540]]],
  ['Hindustan Unilever', 'Glow & Lovely', 'cream', ['Advanced Multivitamin', 'Ayurvedic Care', 'Insta Glow'], [['25g', 65], ['50g', 120], ['80g', 175]]],
  ['Hindustan Unilever', 'Pond\'s', 'cream', ['Bright Beauty', 'Dreamflower Talc', 'Super Light Gel', 'Cold Cream'], [['25g', 75], ['50g', 130], ['100g', 240]]],
  ['ITC Limited', 'Aashirvaad', 'atta', ['Shudh Chakki Atta', 'Multigrain Atta', 'Select Atta', 'Salt'], [['1kg', 60], ['5kg', 290], ['10kg', 560]]],
  ['ITC Limited', 'Sunfeast', 'biscuit', ['Dark Fantasy Choco Fills', 'Marie Light', 'Mom\'s Magic Cashew', 'Bounce Cream', 'Glucose', 'Farmlite Oats'], [['75g', 40], ['150g', 75], ['300g', 140], ['600g', 260]]],
  ['ITC Limited', 'Bingo', 'snack', ['Mad Angles Achaari', 'Mad Angles Tomato', 'Tedhe Medhe', 'Original Style Salted', 'Cream & Onion'], [['30g', 10], ['66g', 20], ['130g', 40]]],
  ['ITC Limited', 'Yippee', 'noodles', ['Magic Masala', 'Mood Masala', 'Power Up Atta'], [['60g', 14], ['240g', 56], ['420g', 98]]],
  ['ITC Limited', 'Classmate', 'note', ['Notebook Single Line', 'Notebook Four Line', 'Long Notebook', 'Drawing Book'], [['72 pages', 32], ['172 pages', 60], ['240 pages', 85]]],
  ['ITC Limited', 'Fiama', 'soap', ['Mandarin & Geranium', 'Patchouli & Macadamia', 'Peach & Avocado'], [['100g', 50], ['3x125g', 180]]],
  ['ITC Limited', 'Vivel', 'soap', ['Aloe Vera', 'Lavender & Almond', 'Mint & Cucumber'], [['100g', 35], ['4x100g', 130]]],
  ['ITC Limited', 'Savlon', 'soap', ['Antiseptic Liquid', 'Hand Wash', 'Glycerin Soap'], [['75g', 30], ['200ml', 99], ['500ml', 185]]],
  ['ITC Limited', 'B Natural', 'juice', ['Mixed Fruit', 'Mango', 'Guava', 'Orange'], [['200ml', 25], ['1L', 120]]],
  ['Britannia Industries', 'Good Day', 'biscuit', ['Cashew', 'Butter', 'Pista Badam', 'Choco Chip'], [['30g', 5], ['75g', 20], ['200g', 50], ['600g', 140]]],
  ['Britannia Industries', 'Marie Gold', 'biscuit', ['Original', 'Wheat'], [['80g', 10], ['250g', 40], ['500g', 75], ['1kg', 140]]],
  ['Britannia Industries', 'Bourbon', 'biscuit', ['Original', 'Dark Fantasy'], [['50g', 10], ['150g', 35], ['300g', 65]]],
  ['Britannia Industries', 'NutriChoice', 'biscuit', ['Digestive', 'Oats Cookies', '5 Grain', 'Ragi'], [['100g', 30], ['250g', 70], ['500g', 130]]],
  ['Britannia Industries', 'Tiger', 'biscuit', ['Glucose', 'Krunch', 'Cream'], [['50g', 5], ['100g', 10], ['250g', 25]]],
  ['Britannia Industries', 'Britannia Cake', 'biscuit', ['Fruit', 'Chocolate', 'Swiss Roll', 'Gobbles'], [['15g', 5], ['60g', 15], ['140g', 40]]],
  ['Britannia Industries', 'Milk Bikis', 'biscuit', ['Classic', 'Atta'], [['50g', 5], ['100g', 10], ['500g', 60]]],
  ['Nestle India', 'Maggi', 'noodles', ['2-Minute Masala', 'Atta Noodles', 'Hot Heads', 'Masala-ae-Magic', 'Tomato Ketchup'], [['32g', 7], ['70g', 14], ['280g', 56], ['560g', 108], ['1kg', 180]]],
  ['Nestle India', 'Nescafe', 'coffee', ['Classic', 'Sunrise Premium', 'Gold Blend'], [['Sachet 1.5g', 2], ['50g', 175], ['100g', 330], ['200g', 640]]],
  ['Nestle India', 'KitKat', 'choco', ['Original', 'Dessert Delight', 'Chunky'], [['13g', 10], ['37g', 30], ['Share Bag 126g', 100]]],
  ['Nestle India', 'Munch', 'choco', ['Original', 'Max', 'Nuts'], [['10g', 5], ['21g', 10], ['36g', 20]]],
  ['Nestle India', 'Milkybar', 'choco', ['Original', 'Choo'], [['12g', 10], ['30g', 25]]],
  ['Nestle India', 'Everyday', 'ghee', ['Dairy Whitener', 'Ghee'], [['18g', 10], ['200g', 110], ['400g', 210], ['1L', 650]]],
  ['Dabur India', 'Dabur Red', 'paste', ['Paste', 'Gel', 'Bae Fresh'], [['20g', 10], ['100g', 60], ['200g', 115]]],
  ['Dabur India', 'Dabur Amla', 'oil', ['Hair Oil', 'Aloe Vera'], [['45ml', 30], ['90ml', 55], ['275ml', 150], ['450ml', 230]]],
  ['Dabur India', 'Real', 'juice', ['Mixed Fruit', 'Mango', 'Guava', 'Litchi', 'Pomegranate'], [['180ml', 20], ['1L', 130]]],
  ['Dabur India', 'Dabur Honey', 'spice', ['Pure Honey', 'Honey Squeezy'], [['50g', 45], ['250g', 135], ['500g', 245]]],
  ['Dabur India', 'Odonil', 'detergent', ['Lavender', 'Jasmine', 'Rose'], [['50g', 55], ['4x50g', 199]]],
  ['Colgate-Palmolive', 'Colgate', 'paste', ['Strong Teeth', 'MaxFresh Red', 'MaxFresh Blue', 'Visible White', 'Sensitive', 'Herbal'], [['20g', 10], ['100g', 58], ['150g', 92], ['200g', 115], ['2x200g', 220]]],
  ['Colgate-Palmolive', 'Palmolive', 'soap', ['Naturals', 'Aroma', 'Thermal Spa'], [['75g', 30], ['100g', 42], ['4x100g', 160]]],
  ['Procter & Gamble', 'Tide', 'detergent', ['Plus Double Power', 'Jasmine & Rose', 'Lemon & Mint', 'Matic'], [['500g', 70], ['1kg', 130], ['2kg', 250], ['4kg', 480]]],
  ['Procter & Gamble', 'Ariel', 'detergent', ['Complete', 'Matic Front Load', 'Matic Top Load', 'Liquid'], [['500g', 125], ['1kg', 240], ['2kg', 460]]],
  ['Procter & Gamble', 'Head & Shoulders', 'shampoo', ['Anti Dandruff', 'Cool Menthol', 'Silky Black'], [['Sachet 16pcs', 32], ['72ml', 80], ['180ml', 199], ['340ml', 365]]],
  ['Procter & Gamble', 'Pantene', 'shampoo', ['Hair Fall Control', 'Silky Smooth', 'Long Black'], [['Sachet 16pcs', 32], ['75ml', 75], ['180ml', 185], ['340ml', 350]]],
  ['Procter & Gamble', 'Gillette', 'cream', ['Guard Razor', 'Mach3', 'Shaving Foam', 'Presto'], [['1pc', 25], ['2pcs', 50], ['200g', 230]]],
  ['Procter & Gamble', 'Whisper', 'cream', ['Ultra Clean XL', 'Choice', 'Bindazzz Nights'], [['7 pads', 99], ['15 pads', 199], ['30 pads', 385]]],
  ['Marico', 'Parachute', 'oil', ['Coconut Oil', 'Advansed Aloe Vera', 'Jasmine'], [['50ml', 30], ['100ml', 55], ['250ml', 130], ['500ml', 245], ['1L', 460]]],
  ['Marico', 'Saffola', 'atta', ['Gold Oil', 'Active Oil', 'Masala Oats', 'Classic Oats'], [['40g', 15], ['400g', 99], ['1L', 210], ['5L', 990]]],
  ['Marico', 'Nihar', 'oil', ['Shanti Amla', 'Naturals Coconut'], [['45ml', 15], ['100ml', 35], ['200ml', 68]]],
  ['Marico', 'Set Wet', 'cream', ['Hair Gel', 'Deo'], [['50ml', 60], ['100ml', 99], ['150ml', 199]]],
  ['Godrej Consumer', 'Cinthol', 'soap', ['Original', 'Lime', 'Cool'], [['100g', 40], ['3x100g', 115]]],
  ['Godrej Consumer', 'Godrej No.1', 'soap', ['Sandal & Turmeric', 'Lime & Aloe', 'Rose & Almond'], [['50g', 10], ['100g', 22], ['4x100g', 85]]],
  ['Godrej Consumer', 'Good Knight', 'detergent', ['Gold Flash Refill', 'Fast Card', 'Power Activ+ Machine'], [['10pcs', 10], ['45ml', 85], ['Combo', 99]]],
  ['Godrej Consumer', 'HIT', 'detergent', ['Mosquito Spray', 'Cockroach Spray', 'Chalk'], [['200ml', 199], ['400ml', 340], ['1pc', 20]]],
  ['Godrej Consumer', 'Godrej Expert', 'oil', ['Rich Crème Hair Colour Black', 'Natural Brown', 'Burgundy'], [['20g', 30], ['Kit', 120]]],
  ['Parle Products', 'Parle-G', 'biscuit', ['Original Gluco', 'Gold'], [['56g', 5], ['100g', 10], ['250g', 25], ['800g', 80]]],
  ['Parle Products', 'Monaco', 'biscuit', ['Classic', 'Jeera', 'Pizza'], [['45g', 10], ['120g', 30], ['200g', 50]]],
  ['Parle Products', 'Hide & Seek', 'biscuit', ['Choco Chip', 'Fab Bourbon', 'Caffe Mocha'], [['42g', 10], ['100g', 30], ['200g', 60]]],
  ['Parle Products', 'Krackjack', 'biscuit', ['Original', 'Masala'], [['40g', 10], ['120g', 30]]],
  ['Parle Products', 'Melody', 'choco', ['Chocolaty', 'Toffee Jar'], [['1pc', 1], ['195g', 50], ['Jar 391g', 100]]],
  ['Parle Products', 'Parle Rusk', 'biscuit', ['Elaichi', 'Milk', 'Suji'], [['200g', 40], ['400g', 75]]],
  ['Tata Consumer Products', 'Tata Tea', 'tea', ['Premium', 'Gold', 'Agni', 'Chakra Gold'], [['100g', 55], ['250g', 135], ['500g', 260], ['1kg', 510]]],
  ['Tata Consumer Products', 'Tata Salt', 'spice', ['Iodised', 'Lite', 'Rock Salt'], [['1kg', 28], ['2kg', 54]]],
  ['Tata Consumer Products', 'Tata Sampann', 'spice', ['Toor Dal', 'Chana Dal', 'Turmeric Powder', 'Chilli Powder', 'Coriander Powder', 'Sambar Masala'], [['100g', 45], ['200g', 85], ['500g', 190], ['1kg', 340]]],
  ['Tata Consumer Products', 'Tetley', 'tea', ['Green Tea Lemon', 'Green Tea Ginger Mint', 'Classic'], [['10 bags', 70], ['25 bags', 165], ['100 bags', 560]]],
  ['Emami', 'Navratna', 'oil', ['Cool Oil', 'Cool Talc', 'Almond'], [['50ml', 40], ['100ml', 75], ['200ml', 140], ['300ml', 205]]],
  ['Emami', 'Boroplus', 'cream', ['Antiseptic Cream', 'Doodh Kesar', 'Aloe Vera Gel'], [['20ml', 40], ['40ml', 75], ['80ml', 135]]],
  ['Emami', 'Zandu Balm', 'cream', ['Balm', 'Ultra Power', 'Pancharishta'], [['8ml', 40], ['25ml', 110]]],
  ['Wipro Consumer Care', 'Santoor', 'soap', ['Sandal & Turmeric', 'White', 'Aloe Fresh', 'Gold'], [['50g', 10], ['100g', 40], ['4x100g', 155], ['4x150g', 215]]],
  ['Wipro Consumer Care', 'Chandrika', 'soap', ['Ayurvedic', 'Gold'], [['75g', 25], ['125g', 45], ['3x125g', 125]]],
  ['Wipro Consumer Care', 'Glucovita', 'drink', ['Orange', 'Lemon', 'Bolts'], [['100g', 40], ['200g', 75], ['400g', 140]]],
  ['Reckitt', 'Dettol', 'soap', ['Original', 'Cool', 'Skincare', 'Antiseptic Liquid', 'Handwash'], [['75g', 40], ['125g', 60], ['200ml', 99], ['500ml', 225], ['1L', 420]]],
  ['Reckitt', 'Harpic', 'dish', ['Power Plus Original', 'Bathroom Cleaner', 'Flushmatic'], [['200ml', 50], ['500ml', 105], ['1L', 199]]],
  ['Reckitt', 'Lizol', 'dish', ['Citrus', 'Floral', 'Pine', 'Lavender'], [['200ml', 52], ['500ml', 115], ['975ml', 215]]],
  ['Reckitt', 'Colin', 'dish', ['Glass Cleaner', 'Refill'], [['250ml', 85], ['500ml', 120]]],
  ['Mondelez India', 'Cadbury Dairy Milk', 'choco', ['Original', 'Silk', 'Fruit & Nut', 'Roast Almond', 'Crackle'], [['13g', 10], ['23g', 20], ['50g', 50], ['150g', 175]]],
  ['Mondelez India', '5 Star', 'choco', ['Original', '3D', 'Oreo'], [['10g', 5], ['22g', 10], ['40g', 20]]],
  ['Mondelez India', 'Bournvita', 'drink', ['Health Drink', 'Pro-Health', 'Little Champs'], [['200g', 115], ['500g', 255], ['1kg', 480]]],
  ['Mondelez India', 'Oreo', 'biscuit', ['Original Vanilla', 'Chocolate', 'Strawberry'], [['50g', 10], ['120g', 35], ['250g', 75]]],
  ['Mondelez India', 'Gems', 'choco', ['Original', 'Surprise'], [['8g', 5], ['17g', 10], ['Ball', 60]]],
  ['Mondelez India', 'Tang', 'juice', ['Orange', 'Lemon', 'Mango'], [['100g', 45], ['500g', 175], ['1kg', 320]]],
];
const prods = []; const seen = new Set();
outer: for (let round = 0; round < 6; round++) for (const [co, brand, cat, vars, sizes] of B) for (const v of vars) for (const [sz, mrp0] of sizes) {
  const name = `${brand} ${v} ${sz}`.replace(/\s+/g, ' ');
  const key = round ? `${name} (${['', 'Promo Pack', 'Combo Offer', 'New', 'Value Pack', 'Festive Pack'][round]})` : name;
  if (seen.has(key)) continue; seen.add(key);
  const [hsn, gst, , cs] = CAT[cat];
  const mrp = Math.max(1, Math.round(mrp0 * (round ? 0.9 + rnd() * 0.25 : 1)));
  const rate = Math.round(mrp * (0.78 + rnd() * 0.06) * 100) / 100; // distributor selling rate (PTR)
  const buy = Math.round(rate * (0.9 + rnd() * 0.04) * 100) / 100;
  const caseSize = mrp > 300 ? Math.max(4, Math.round(cs / 4)) : mrp > 100 ? Math.max(6, Math.round(cs / 2)) : cs;
  prods.push({ name: key, company: co, code: `${co.split(' ').map(w => w[0]).join('')}${String(prods.length + 1).padStart(5, '0')}`, hsn, gst, mrp, rate, buy, caseSize });
  if (prods.length >= 2000) break outer;
}

// 1,200 shops: 4 salesmen × 6 days = 24 beats, one area each, 50 shops a beat
const AREAS = ['Tittakudi', 'Pennadam', 'Virudhachalam', 'Neyveli', 'Panruti', 'Vadalur', 'Chidambaram', 'Kattumannarkoil', 'Srimushnam', 'Mangalampettai', 'Avinangudi', 'Thozhudur',
  'Ulundurpet', 'Veppur', 'Kurinjipadi', 'Bhuvanagiri', 'Sethiathope', 'Nallur', 'Mangalur', 'Kammapuram', 'Annagramam', 'Nellikuppam', 'Thittagudi East', 'Karuveppilankurichi'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PRE = ['Sri', 'New', 'Annai', 'Sree', 'Om', 'Jai', '', '', ''];
const NAMES = ['Murugan', 'Lakshmi', 'Ganapathi', 'Vinayaga', 'Balaji', 'Selvam', 'Kumaran', 'Saravana', 'Senthil', 'Velan', 'Amman', 'Karpagam', 'Mariamman', 'Ayyanar', 'Kannan', 'Raja', 'Mani', 'Ravi', 'Sakthi', 'Thirumalai', 'Arul', 'Muthu', 'Krishna', 'Sivan', 'Durga', 'Kaveri', 'Ponni', 'Vetri', 'Jothi', 'Bharathi'];
const SUF = ['Stores', 'Provisions', 'Traders', 'Super Market', 'Agencies', 'Departmental Store', 'Mart', 'Kirana', 'General Stores', 'Rice Mandi'];
const shops = []; const shopSeen = new Set();
const gstinWithCheck = f => { const ch = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = 0; for (let i = 0; i < 14; i++) { const v = ch.indexOf(f[i]) * (i % 2 === 0 ? 1 : 2); s += Math.floor(v / 36) + (v % 36); } return f + ch[(36 - (s % 36)) % 36]; };
for (let a = 0; a < AREAS.length; a++) for (let k = 0; k < 50; k++) {
  let name; do { name = `${pick(PRE)} ${pick(NAMES)} ${pick(SUF)}`.trim(); } while (shopSeen.has(`${name}|${AREAS[a]}`));
  shopSeen.add(`${name}|${AREAS[a]}`);
  const big = rnd() < 0.12;
  const pan = `AA${'ABCDEFGHJK'[k % 10]}F${'PQRST'[a % 5]}${String(1000 + a * 50 + k).slice(-4)}${'ABCDEFGHJKLMN'[k % 13]}`;
  shops.push({ name, owner: pick(NAMES), phone: `9${String(400000000 + a * 1000 + k * 7).padStart(9, '0')}`, gstin: big ? gstinWithCheck(`33${pan}1Z`) : '', area: AREAS[a], beat: DAYS[a % 6], salesman: Math.floor(a / 6), creditLimit: big ? 75000 : pick([10000, 15000, 20000, 25000]), creditDays: big ? 21 : pick([7, 7, 10, 15]), address: `${k + 1}, Main Road, ${AREAS[a]}` });
}

const STAFF = [
  ['Arun (Owner)', '9790000001', 'owner', '4821'], ['Deepa (Office)', '9790000002', 'office', '5732'],
  ['Ravi (Salesman)', '9790000003', 'salesman', '6143'], ['Suresh (Salesman)', '9790000004', 'salesman', '6254'], ['Bala (Salesman)', '9790000005', 'salesman', '6365'], ['Kavin (Salesman)', '9790000006', 'salesman', '6476'],
  ['Mani (Godown)', '9790000007', 'godown', '7587'], ['Prakash (Godown)', '9790000008', 'godown', '7698'],
  ['Karthik (Delivery)', '9790000009', 'delivery', '8709'], ['Vignesh (Delivery)', '9790000010', 'delivery', '8810'],
];
const FIRM = { firmName: 'Arun FMCG Distributors', ownerName: 'Arun', gstin: gstinWithCheck('33AAQFA4821K1Z'), phone: STAFF[0][1], pin: STAFF[0][3] };

const write = (file, rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1'); XLSX.writeFile(wb, path.join(OUT, file)); };
write('products.xlsx', [['Product', 'Company', 'Code', 'HSN', 'GST %', 'MRP', 'Rate', 'Purchase', 'Case'], ...prods.map(p => [p.name, p.company, p.code, p.hsn, p.gst, p.mrp, p.rate, p.buy, p.caseSize])]);
write('shops.xlsx', [['Shop', 'Owner', 'Mobile', 'GSTIN', 'Area', 'Beat', 'Credit limit', 'Credit days', 'Address'], ...shops.map(s => [s.name, s.owner, s.phone, s.gstin, s.area, s.beat, s.creditLimit, s.creditDays, s.address])]);
// opening stock: one purchase bill per company, enough for about 6 weeks of selling
const byCo = {}; for (const p of prods) (byCo[p.company] ??= []).push(p);
const coFiles = [];
Object.entries(byCo).forEach(([co, list], i) => {
  const f = `stock-${String(i + 1).padStart(2, '0')}.xlsx`; coFiles.push({ company: co, file: f, lines: list.length });
  const exp = m => { const d = new Date(Date.now() + m * 30 * 86400000); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`; };
  write(f, [[`${co} — Tax Invoice`], [`Invoice No: ${co.split(' ')[0].toUpperCase()}/OPEN/${i + 1}`], [`Date: ${new Date().toISOString().slice(0, 10)}`], [],
    ['Item', 'Code', 'HSN', 'Batch', 'Expiry', 'MRP', 'Qty', 'Rate', 'GST %', 'Amount'],
    ...list.map((p, k) => { const qty = p.caseSize * (p.mrp > 300 ? 6 : 20); return [p.name, p.code, p.hsn, `B${i}${String(k).padStart(4, '0')}`, exp(6 + (k % 12)), p.mrp, qty, p.buy, p.gst, Math.round(qty * p.buy * 100) / 100]; })]);
});
fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify({ firm: FIRM, staff: STAFF, products: prods, shops, areas: AREAS, days: DAYS, stockFiles: coFiles }, null, 1));
console.log(`products ${prods.length} · companies ${Object.keys(byCo).length} · shops ${shops.length} · staff ${STAFF.length} · stock bills ${coFiles.length}`);
