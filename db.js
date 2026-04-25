
const { Pool } = require(‘pg’);
require(‘dotenv’).config();
const pool = new Pool({
host:process.env.DB_HOST, port:process.env.DB_PORT,
database:process.env.DB_NAME, user:process.env.DB_USER, password:process.env.DB_PASSWORD,
});

async function initDB() {
const c = await pool.connect();
try {
await c.query(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,pin VARCHAR(10) UNIQUE NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'waiter',active BOOLEAN DEFAULT true,created_at TIMESTAMP DEFAULT NOW()); CREATE TABLE IF NOT EXISTS tables(id SERIAL PRIMARY KEY,number INTEGER UNIQUE NOT NULL,status VARCHAR(20) DEFAULT 'empty'); CREATE TABLE IF NOT EXISTS categories(id SERIAL PRIMARY KEY,name VARCHAR(100) NOT NULL,color VARCHAR(20) DEFAULT '#2563eb',sort_order INTEGER DEFAULT 0,active BOOLEAN DEFAULT true); CREATE TABLE IF NOT EXISTS subcategories(id SERIAL PRIMARY KEY,category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,name VARCHAR(100) NOT NULL,sort_order INTEGER DEFAULT 0,active BOOLEAN DEFAULT true); CREATE TABLE IF NOT EXISTS products(id SERIAL PRIMARY KEY,category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,name VARCHAR(150) NOT NULL,price DECIMAL(10,2) NOT NULL,description TEXT,color VARCHAR(20) DEFAULT '#2563eb',product_type VARCHAR(20) DEFAULT 'food',active BOOLEAN DEFAULT true,sort_order INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS orders(id SERIAL PRIMARY KEY,table_id INTEGER REFERENCES tables(id),user_id INTEGER REFERENCES users(id),type VARCHAR(20) DEFAULT 'dine-in',status VARCHAR(30) DEFAULT 'open',payment_method VARCHAR(20),discount_type VARCHAR(20),discount_value DECIMAL(10,2) DEFAULT 0,created_at TIMESTAMP DEFAULT NOW(),closed_at TIMESTAMP,total DECIMAL(10,2) DEFAULT 0); CREATE TABLE IF NOT EXISTS order_items(id SERIAL PRIMARY KEY,order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,product_id INTEGER REFERENCES products(id),product_name VARCHAR(150) NOT NULL,product_price DECIMAL(10,2) NOT NULL,quantity INTEGER NOT NULL DEFAULT 1,notes TEXT,product_type VARCHAR(20) DEFAULT 'food',sent_to_kitchen BOOLEAN DEFAULT false,cancelled BOOLEAN DEFAULT false,cancelled_at TIMESTAMP,cancelled_by INTEGER REFERENCES users(id),created_at TIMESTAMP DEFAULT NOW()); CREATE TABLE IF NOT EXISTS kitchen_tickets(id SERIAL PRIMARY KEY,order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,table_number INTEGER,waiter_name VARCHAR(100),items JSONB NOT NULL,daily_num INTEGER DEFAULT 1,destination VARCHAR(20) DEFAULT 'kitchen',is_cancellation BOOLEAN DEFAULT false,created_at TIMESTAMP DEFAULT NOW()); CREATE TABLE IF NOT EXISTS split_bills(id SERIAL PRIMARY KEY,order_id INTEGER REFERENCES orders(id),split_index INTEGER,items JSONB,subtotal DECIMAL(10,2),payment_method VARCHAR(20),created_at TIMESTAMP DEFAULT NOW()); CREATE TABLE IF NOT EXISTS pending_carts(id SERIAL PRIMARY KEY,table_id INTEGER,waiter_id INTEGER REFERENCES users(id),is_takeaway BOOLEAN DEFAULT false,items JSONB NOT NULL,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW(),UNIQUE(table_id,waiter_id)); CREATE TABLE IF NOT EXISTS settings(key VARCHAR(100) PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW());`);
// Seed admin
const ac = await c.query(“SELECT id FROM users WHERE role=‘admin’ LIMIT 1”);
if (!ac.rows.length) await c.query(“INSERT INTO users(name,pin,role)VALUES($1,$2,$3)”,[‘Admin’,‘0000’,‘admin’]);
// Seed 60 tables
const tc = await c.query(“SELECT COUNT(*) FROM tables”);
if (parseInt(tc.rows[0].count) === 0)
for (let i=1;i<=60;i++) await c.query(“INSERT INTO tables(number)VALUES($1)ON CONFLICT DO NOTHING”,[i]);
// Default settings
const defs = [
[‘receipt_name’,‘My Restaurant’],[‘receipt_address’,’’],[‘receipt_phone’,’’],
[‘receipt_vat’,’’],[‘receipt_footer’,‘Thank you!’],[‘receipt_show_waiter’,‘true’],
[‘kitchen_code’,‘1234’],
[‘printer_1_name’,’’],[‘printer_1_dest’,‘kitchen’],[‘printer_1_ip’,’’],[‘printer_1_type’,‘usb’],
[‘printer_2_name’,’’],[‘printer_2_dest’,‘bar’],[‘printer_2_ip’,’’],[‘printer_2_type’,‘usb’],
[‘printer_3_name’,’’],[‘printer_3_dest’,‘receipt’],[‘printer_3_ip’,’’],[‘printer_3_type’,‘usb’],
[‘printer_4_name’,’’],[‘printer_4_dest’,‘all’],[‘printer_4_ip’,’’],[‘printer_4_type’,‘usb’],
];
for (const [k,v] of defs)
await c.query(“INSERT INTO settings(key,value)VALUES($1,$2)ON CONFLICT(key)DO NOTHING”,[k,v]);
console.log(‘DB ready’);
} finally { c.release(); }
}

async function migrateDB() {
const c = await pool.connect();
try {
const stmts = [
“ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20)”,
“ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20)”,
“ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2) DEFAULT 0”,
“ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER”,
“ALTER TABLE products ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT ‘#2563eb’”,
“ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT ‘food’”,
“ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT ‘#2563eb’”,
“ALTER TABLE products ALTER COLUMN subcategory_id DROP NOT NULL”,
“ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT ‘food’”,
“ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false”,
“ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP”,
“ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancelled_by INTEGER”,
“ALTER TABLE kitchen_tickets ADD COLUMN IF NOT EXISTS daily_num INTEGER DEFAULT 1”,
“ALTER TABLE kitchen_tickets ADD COLUMN IF NOT EXISTS destination VARCHAR(20) DEFAULT ‘kitchen’”,
“ALTER TABLE kitchen_tickets ADD COLUMN IF NOT EXISTS is_cancellation BOOLEAN DEFAULT false”,
“CREATE TABLE IF NOT EXISTS settings(key VARCHAR(100) PRIMARY KEY,value TEXT NOT NULL,updated_at TIMESTAMP DEFAULT NOW())”,
“CREATE TABLE IF NOT EXISTS split_bills(id SERIAL PRIMARY KEY,order_id INTEGER REFERENCES orders(id),split_index INTEGER,items JSONB,subtotal DECIMAL(10,2),payment_method VARCHAR(20),created_at TIMESTAMP DEFAULT NOW())”,
“CREATE TABLE IF NOT EXISTS pending_carts(id SERIAL PRIMARY KEY,table_id INTEGER,waiter_id INTEGER REFERENCES users(id),is_takeaway BOOLEAN DEFAULT false,items JSONB NOT NULL,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW())”,
];
for (const s of stmts) try { await c.query(s); } catch {}
const defs = [
[‘kitchen_code’,‘1234’],
[‘printer_1_name’,’’],[‘printer_1_dest’,‘kitchen’],[‘printer_1_ip’,’’],[‘printer_1_type’,‘usb’],
[‘printer_2_name’,’’],[‘printer_2_dest’,‘bar’],[‘printer_2_ip’,’’],[‘printer_2_type’,‘usb’],
[‘printer_3_name’,’’],[‘printer_3_dest’,‘receipt’],[‘printer_3_ip’,’’],[‘printer_3_type’,‘usb’],
[‘printer_4_name’,’’],[‘printer_4_dest’,‘all’],[‘printer_4_ip’,’’],[‘printer_4_type’,‘usb’],
[‘receipt_name’,‘My Restaurant’],[‘receipt_footer’,‘Thank you!’],[‘receipt_show_waiter’,‘true’],
];
for (const [k,v] of defs) await c.query(“INSERT INTO settings(key,value)VALUES($1,$2)ON CONFLICT(key)DO NOTHING”,[k,v]);
console.log(‘Migration done’);
} finally { c.release(); }
}

module.exports = { pool, initDB, migrateDB };
