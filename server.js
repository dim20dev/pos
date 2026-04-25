const express = require(‘express’);
const cors = require(‘cors’);
const http = require(‘http’);
const path = require(‘path’);
const os = require(‘os’);
const { Server } = require(‘socket.io’);
require(‘dotenv’).config();
const { initDB, migrateDB, pool } = require(’./db’);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ‘*’ } });

app.use(cors());
app.use(express.json());
app.set(‘io’, io);

// All frontend files are directly in the frontend folder
const frontendPath = path.join(__dirname, ‘..’, ‘frontend’);
app.use(express.static(frontendPath));

// Main POS — laptop AND tablet both use the same index.html
app.get(’/’,            (*, res) => res.sendFile(path.join(frontendPath, ‘index.html’)));
app.get(’/tablet’,      (*, res) => res.sendFile(path.join(frontendPath, ‘index.html’)));
app.get(’/kitchen’,     (*, res) => res.sendFile(path.join(frontendPath, ‘kitchen.html’)));
app.get(’/printserver’, (*, res) => res.sendFile(path.join(frontendPath, ‘printserver.html’)));

// API Routes
app.use(’/api/auth’,     require(’./routes/auth’));
app.use(’/api/tables’,   require(’./routes/tables’));
app.use(’/api/orders’,   require(’./routes/orders’));
app.use(’/api/menu’,     require(’./routes/menu’));
app.use(’/api/users’,    require(’./routes/users’));
app.use(’/api/settings’, require(’./routes/settings’));
app.get(’/api/health’,   (_, r) => r.json({ ok: true, time: new Date() }));

function getIp() {
for (const nets of Object.values(os.networkInterfaces()))
for (const n of nets)
if (n.family === ‘IPv4’ && !n.internal) return n.address;
return ‘localhost’;
}

// ── SOCKET.IO ─────────────────────────────────────────
io.on(‘connection’, socket => {
socket.on(‘join_kitchen’, () => { socket.join(‘kitchen’); socket.join(‘kscreens’); });
socket.on(‘join_bar’,     () => { socket.join(‘bar’);     socket.join(‘kscreens’); });
socket.on(‘ticket_done’,     d  => socket.to(‘kscreens’).emit(‘ticket_done’, d));
socket.on(‘ticket_undone’,   d  => socket.to(‘kscreens’).emit(‘ticket_undone’, d));
socket.on(‘tickets_cleared’, () => socket.to(‘kscreens’).emit(‘tickets_cleared’));
socket.on(‘join_printserver’,() => socket.join(‘printserver’));

socket.on(‘print_split_request’, (data) => {
io.emit(‘print_split_request’, data);
});

socket.on(‘print_receipt_request’, async (data) => {
try {
const r = await pool.query(
’SELECT o.*,t.number as table_number,u.name as waiter_name FROM orders o ’ +
’LEFT JOIN tables t ON o.table_id=t.id ’ +
‘LEFT JOIN users u ON o.user_id=u.id WHERE o.id=$1’,
[data.order_id]
);
if (!r.rows.length) return;
const order = r.rows[0];
const items = await pool.query(
‘SELECT * FROM order_items WHERE order_id=$1 AND cancelled=false ORDER BY created_at’,
[order.id]
);
order.items = items.rows;
io.emit(‘print_receipt’, { order });
} catch(e) { console.error(‘print_receipt_request error:’, e.message); }
});

socket.on(‘print_revenue_request’, async () => {
try {
const r = await pool.query(
“SELECT COALESCE(SUM(CASE WHEN payment_method=‘cash’ THEN total ELSE 0 END),0) as cash_total,” +
“COALESCE(SUM(CASE WHEN payment_method=‘card’ THEN total ELSE 0 END),0) as card_total,” +
“COALESCE(SUM(total),0) as grand_total, COUNT(*) as order_count “ +
“FROM orders WHERE status=‘closed’ AND DATE(closed_at)=CURRENT_DATE”
);
io.emit(‘print_revenue’, { summary: r.rows[0] });
} catch(e) { console.error(‘print_revenue_request error:’, e.message); }
});
});

const PORT = process.env.PORT || 3001;
initDB().then(() => migrateDB()).then(() => {
server.listen(PORT, ‘0.0.0.0’, () => {
const ip = getIp();
console.log(’\n╔══════════════════════════════════════════════╗’);
console.log(‘║             MESA POS  v2.0                   ║’);
console.log(‘╠══════════════════════════════════════════════╣’);
console.log(‘║  Laptop:      http://localhost:’ + PORT + ’           ║’);
console.log(‘║  Tablet:      http://’ + ip + ‘:’ + PORT + ‘/tablet    ║’);
console.log(‘║  Kitchen:     http://’ + ip + ‘:’ + PORT + ‘/kitchen   ║’);
console.log(‘║  Printserver: http://localhost:’ + PORT + ‘/printserver ║’);
console.log(‘╚══════════════════════════════════════════════╝\n’);
});
}).catch(e => { console.error(‘Failed to start:’, e.message); process.exit(1); });
