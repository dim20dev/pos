const express = require(‘express’);
const router = express.Router();
const { pool } = require(’../db’);
const { authMiddleware, adminOnly } = require(’../middleware’);

async function recalcTotal(orderId) {
const r = await pool.query(‘SELECT COALESCE(SUM(product_price*quantity),0) as raw FROM order_items WHERE order_id=$1 AND cancelled=false’, [orderId]);
const raw = parseFloat(r.rows[0].raw);
const o = await pool.query(‘SELECT discount_type,discount_value FROM orders WHERE id=$1’, [orderId]);
let total = raw;
if (o.rows.length) {
const { discount_type: dt, discount_value: dv } = o.rows[0];
if (dt === ‘percent’) total = raw * (1 - parseFloat(dv||0)/100);
else if (dt === ‘fixed’) total = Math.max(0, raw - parseFloat(dv||0));
}
await pool.query(‘UPDATE orders SET total=$1 WHERE id=$2’, [total.toFixed(2), orderId]);
return total;
}

// ── NAMED ROUTES MUST COME BEFORE /:orderId ──────────────────────────────────

// GET open order for a table
router.get(’/table/:tableId’, authMiddleware, async (req,res) => {
try {
const r = await pool.query(
`SELECT o.*,t.number as table_number,u.name as waiter_name FROM orders o LEFT JOIN tables t ON o.table_id=t.id LEFT JOIN users u ON o.user_id=u.id WHERE o.table_id=$1 AND o.status IN('open','bill_requested') ORDER BY o.created_at DESC LIMIT 1`,
[req.params.tableId]);
if (!r.rows.length) return res.json(null);
const order = r.rows[0];
const items = await pool.query(‘SELECT * FROM order_items WHERE order_id=$1 AND cancelled=false ORDER BY created_at’,[order.id]);
order.items = items.rows;
res.json(order);
} catch(e) { res.status(500).json({error:e.message}); }
});

// GET all orders (admin) with filters
router.get(’/all’, authMiddleware, adminOnly, async (req,res) => {
try {
const { status, waiter, table, date_from, date_to } = req.query;
let where = [‘1=1’], params = [], i = 1;
if (status && status !== ‘all’) { where.push(`o.status=$${i++}`); params.push(status); }
if (table) { where.push(`t.number=$${i++}`); params.push(parseInt(table)); }
if (waiter) { where.push(`u.name ILIKE $${i++}`); params.push(’%’+waiter+’%’); }
if (date_from) { where.push(`DATE(o.created_at)>=$${i++}`); params.push(date_from); }
if (date_to) { where.push(`DATE(o.created_at)<=$${i++}`); params.push(date_to); }
const r = await pool.query(
`SELECT o.*,t.number as table_number,u.name as waiter_name, (SELECT MIN(kt.daily_num) FROM kitchen_tickets kt WHERE kt.order_id=o.id AND kt.is_cancellation=false) as daily_ticket_num FROM orders o LEFT JOIN tables t ON o.table_id=t.id LEFT JOIN users u ON o.user_id=u.id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 500`, params);
res.json(r.rows);
} catch(e) { res.status(500).json({error:e.message}); }
});

// GET daily summary
router.get(’/summary/daily’, authMiddleware, async (req,res) => {
try {
const r = await pool.query(
`SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) as cash_total, COALESCE(SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END),0) as card_total, COALESCE(SUM(total),0) as grand_total, COUNT(*) as order_count FROM orders WHERE status='closed' AND DATE(closed_at)=CURRENT_DATE`);
res.json(r.rows[0]);
} catch(e) { res.status(500).json({error:e.message}); }
});

// GET reports
router.get(’/reports/:period’, authMiddleware, adminOnly, async (req,res) => {
const f = {today:“AND DATE(closed_at)=CURRENT_DATE”,week:“AND closed_at>=NOW()-INTERVAL ‘7 days’”,month:“AND closed_at>=NOW()-INTERVAL ‘30 days’”,year:“AND closed_at>=NOW()-INTERVAL ‘365 days’”}[req.params.period]||“AND DATE(closed_at)=CURRENT_DATE”;
try {
const summary = await pool.query(`SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) as cash_total,COALESCE(SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END),0) as card_total,COALESCE(SUM(total),0) as grand_total,COUNT(*) as order_count,COUNT(DISTINCT DATE(closed_at)) as days_active FROM orders WHERE status='closed' ${f}`);
const daily = await pool.query(`SELECT DATE(closed_at) as day,COALESCE(SUM(total),0) as total,COUNT(*) as orders,COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) as cash,COALESCE(SUM(CASE WHEN payment_method='card' THEN total ELSE 0 END),0) as card FROM orders WHERE status='closed' ${f} GROUP BY DATE(closed_at) ORDER BY day DESC LIMIT 60`);
const top = await pool.query(`SELECT oi.product_name,SUM(oi.quantity) as qty,SUM(oi.product_price*oi.quantity) as revenue FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='closed' AND oi.cancelled=false ${f} GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`);
const cancels = await pool.query(`SELECT COUNT(*) as count,COALESCE(SUM(oi.product_price*oi.quantity),0) as value FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE oi.cancelled=true ${f.replace('closed_at','o.created_at')}`);
const discounts = await pool.query(`SELECT COUNT(*) as count,COALESCE(SUM(discount_value),0) as total_disc FROM orders WHERE status='closed' AND discount_type IS NOT NULL ${f}`);
res.json({ summary:summary.rows[0], daily:daily.rows, topProducts:top.rows, cancels:cancels.rows[0], discounts:discounts.rows[0] });
} catch(e) { res.status(500).json({error:e.message}); }
});

// GET pending cart for a specific waiter (private — only they can see it)
router.get(’/pending-cart’, authMiddleware, async (req, res) => {
const { table_id, is_takeaway } = req.query;
try {
let r;
if (is_takeaway === ‘true’) {
r = await pool.query(‘SELECT * FROM pending_carts WHERE waiter_id=$1 AND is_takeaway=true ORDER BY updated_at DESC LIMIT 1’, [req.user.id]);
} else {
r = await pool.query(‘SELECT * FROM pending_carts WHERE table_id=$1 AND waiter_id=$2 LIMIT 1’, [table_id, req.user.id]);
}
res.json(r.rows[0] || null);
} catch(e) { res.status(500).json({ error: e.message }); }
});

// GET single order — MUST BE AFTER all named GET routes
router.get(’/:orderId’, authMiddleware, async (req,res) => {
try {
const r = await pool.query(
`SELECT o.*,t.number as table_number,u.name as waiter_name, (SELECT MIN(kt.daily_num) FROM kitchen_tickets kt WHERE kt.order_id=o.id AND kt.is_cancellation=false) as daily_ticket_num FROM orders o LEFT JOIN tables t ON o.table_id=t.id LEFT JOIN users u ON o.user_id=u.id WHERE o.id=$1`,
[req.params.orderId]);
if (!r.rows.length) return res.status(404).json({error:‘Not found’});
const order = r.rows[0];
const items = await pool.query(
`SELECT oi.*,cu.name as cancelled_by_name FROM order_items oi LEFT JOIN users cu ON oi.cancelled_by=cu.id WHERE oi.order_id=$1 ORDER BY oi.created_at`,
[order.id]);
order.items = items.rows;
const splits = await pool.query(‘SELECT * FROM split_bills WHERE order_id=$1 ORDER BY split_index’,[order.id]);
order.splits = splits.rows;
res.json(order);
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST create order
router.post(’/’, authMiddleware, async (req,res) => {
const { table_id, type } = req.body;
try {
if (table_id) {
await pool.query(“UPDATE tables SET status=‘occupied’ WHERE id=$1”,[table_id]);
req.app.get(‘io’).emit(‘table_update’,{id:table_id,status:‘occupied’});
}
const r = await pool.query(‘INSERT INTO orders(table_id,user_id,type)VALUES($1,$2,$3)RETURNING *’,[table_id||null,req.user.id,type||‘dine-in’]);
res.json(r.rows[0]);
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST add items
router.post(’/:orderId/items’, authMiddleware, async (req,res) => {
const { items } = req.body;
try {
for (const item of items)
await pool.query(‘INSERT INTO order_items(order_id,product_id,product_name,product_price,quantity,notes,product_type,cancelled)VALUES($1,$2,$3,$4,$5,$6,$7,false)’,
[req.params.orderId,item.product_id||null,item.product_name,item.product_price,item.quantity,item.notes||null,item.product_type||‘food’]);
await recalcTotal(req.params.orderId);
res.json((await pool.query(‘SELECT * FROM order_items WHERE order_id=$1 AND cancelled=false ORDER BY created_at’,[req.params.orderId])).rows);
} catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE single item (soft cancel)
router.delete(’/items/:itemId’, authMiddleware, async (req,res) => {
try {
const itR = await pool.query(‘SELECT * FROM order_items WHERE id=$1’,[req.params.itemId]);
if (!itR.rows.length) return res.status(404).json({error:‘Item not found’});
const it = itR.rows[0];
await pool.query(‘UPDATE order_items SET cancelled=true,cancelled_at=NOW(),cancelled_by=$1 WHERE id=$2’,[req.user.id,req.params.itemId]);
await recalcTotal(it.order_id);
const remaining = parseInt((await pool.query(‘SELECT COUNT(*) as cnt FROM order_items WHERE order_id=$1 AND cancelled=false’,[it.order_id])).rows[0].cnt);
const ordR = await pool.query(`SELECT o.*,t.number as table_number,u.name as waiter_name FROM orders o LEFT JOIN tables t ON o.table_id=t.id LEFT JOIN users u ON o.user_id=u.id WHERE o.id=$1`,[it.order_id]);
const order = ordR.rows[0];
let tableFreed = false;
if (remaining === 0 && order?.table_id) {
await pool.query(“UPDATE orders SET status=‘closed’,closed_at=NOW() WHERE id=$1”,[it.order_id]);
await pool.query(“UPDATE tables SET status=‘empty’ WHERE id=$1”,[order.table_id]);
req.app.get(‘io’).emit(‘table_update’,{id:order.table_id,status:‘empty’});
tableFreed = true;
}
let cancellation = { sent: false };
if (it.sent_to_kitchen && order) {
const dest = it.product_type === ‘drink’ ? ‘bar’ : ‘kitchen’;
const numR = await pool.query(‘SELECT COALESCE(MAX(daily_num),0)+1 as num FROM kitchen_tickets WHERE DATE(created_at)=CURRENT_DATE’);
const ticketNum = parseInt(numR.rows[0].num);
await pool.query(‘INSERT INTO kitchen_tickets(order_id,table_number,waiter_name,items,daily_num,destination,is_cancellation)VALUES($1,$2,$3,$4,$5,$6,true)’,
[it.order_id,order.table_number,order.waiter_name,JSON.stringify([it]),ticketNum,dest]);
req.app.get(‘io’).to(dest).emit(‘cancellation_ticket’,{table_number:order.table_number,waiter_name:order.waiter_name,item:it,ticket_num:ticketNum,destination:dest});
cancellation = { sent:true, destination:dest, item:it, ticket_num:ticketNum };
}
res.json({ success:true, cancellation, table_freed:tableFreed });
} catch(e) { res.status(500).json({error:e.message}); }
});

// DELETE entire order (admin)
router.delete(’/:orderId’, authMiddleware, adminOnly, async (req,res) => {
const c = await pool.connect();
try {
await c.query(‘BEGIN’);
const r = await c.query(‘SELECT * FROM orders WHERE id=$1’,[req.params.orderId]);
if (!r.rows.length) { await c.query(‘ROLLBACK’); return res.status(404).json({error:‘Not found’}); }
const o = r.rows[0];
await c.query(‘DELETE FROM order_items WHERE order_id=$1’,[req.params.orderId]);
await c.query(‘DELETE FROM kitchen_tickets WHERE order_id=$1’,[req.params.orderId]);
await c.query(‘DELETE FROM split_bills WHERE order_id=$1’,[req.params.orderId]);
await c.query(‘DELETE FROM orders WHERE id=$1’,[req.params.orderId]);
if (o.table_id) { await c.query(“UPDATE tables SET status=‘empty’ WHERE id=$1”,[o.table_id]); req.app.get(‘io’).emit(‘table_update’,{id:o.table_id,status:‘empty’}); }
await c.query(‘COMMIT’);
res.json({success:true});
} catch(e) { await c.query(‘ROLLBACK’); res.status(500).json({error:e.message}); }
finally { c.release(); }
});

// POST send to kitchen/bar
router.post(’/:orderId/send-kitchen’, authMiddleware, async (req,res) => {
const c = await pool.connect();
try {
await c.query(‘BEGIN’);
const ordR = await c.query(`SELECT o.*,t.number as table_number,u.name as waiter_name FROM orders o LEFT JOIN tables t ON o.table_id=t.id LEFT JOIN users u ON o.user_id=u.id WHERE o.id=$1`,[req.params.orderId]);
if (!ordR.rows.length) { await c.query(‘ROLLBACK’); return res.status(404).json({error:‘Not found’}); }
const order = ordR.rows[0];
const newItems = await c.query(‘SELECT * FROM order_items WHERE order_id=$1 AND sent_to_kitchen=false AND cancelled=false’,[req.params.orderId]);
if (!newItems.rows.length) { await c.query(‘ROLLBACK’); return res.status(400).json({error:‘No new items’}); }
await c.query(‘UPDATE order_items SET sent_to_kitchen=true WHERE order_id=$1 AND sent_to_kitchen=false AND cancelled=false’,[req.params.orderId]);
const ticketNum = parseInt((await c.query(‘SELECT COALESCE(MAX(daily_num),0)+1 as num FROM kitchen_tickets WHERE DATE(created_at)=CURRENT_DATE’)).rows[0].num);
const foodItems = newItems.rows.filter(i => i.product_type !== ‘drink’);
const drinkItems = newItems.rows.filter(i => i.product_type === ‘drink’);
if (foodItems.length) await c.query(‘INSERT INTO kitchen_tickets(order_id,table_number,waiter_name,items,daily_num,destination,is_cancellation)VALUES($1,$2,$3,$4,$5,$6,false)’,[req.params.orderId,order.table_number,order.waiter_name,JSON.stringify(foodItems),ticketNum,‘kitchen’]);
if (drinkItems.length) await c.query(‘INSERT INTO kitchen_tickets(order_id,table_number,waiter_name,items,daily_num,destination,is_cancellation)VALUES($1,$2,$3,$4,$5,$6,false)’,[req.params.orderId,order.table_number,order.waiter_name,JSON.stringify(drinkItems),ticketNum,‘bar’]);
await c.query(‘COMMIT’);
const io = req.app.get(‘io’);
if (foodItems.length) io.to(‘kitchen’).emit(‘new_ticket’,{table_number:order.table_number,waiter_name:order.waiter_name,items:foodItems,ticket_num:ticketNum,destination:‘kitchen’,order_type:order.type});
if (drinkItems.length) io.to(‘bar’).emit(‘new_ticket’,{table_number:order.table_number,waiter_name:order.waiter_name,items:drinkItems,ticket_num:ticketNum,destination:‘bar’,order_type:order.type});
res.json({success:true,items:newItems.rows,ticket_num:ticketNum,food_items:foodItems,drink_items:drinkItems});
} catch(e) { await c.query(‘ROLLBACK’); res.status(500).json({error:e.message}); }
finally { c.release(); }
});

// POST apply discount
router.post(’/:orderId/discount’, authMiddleware, async (req,res) => {
const { discount_type, discount_value } = req.body;
try {
await pool.query(‘UPDATE orders SET discount_type=$1,discount_value=$2 WHERE id=$3’,[discount_type||null,parseFloat(discount_value)||0,req.params.orderId]);
const total = await recalcTotal(req.params.orderId);
res.json({success:true,total});
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST save split bill
router.post(’/:orderId/split’, authMiddleware, async (req,res) => {
const { splits } = req.body;
try {
await pool.query(‘DELETE FROM split_bills WHERE order_id=$1’,[req.params.orderId]);
for (let i=0;i<splits.length;i++) {
const sp = splits[i];
await pool.query(‘INSERT INTO split_bills(order_id,split_index,items,subtotal,payment_method)VALUES($1,$2,$3,$4,$5)’,[req.params.orderId,i+1,JSON.stringify(sp.items),sp.subtotal,sp.payment_method||null]);
}
res.json({success:true});
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST request bill (table turns blue)
router.post(’/:orderId/request-bill’, authMiddleware, async (req,res) => {
try {
const r = await pool.query(‘SELECT * FROM orders WHERE id=$1’,[req.params.orderId]);
if (!r.rows.length) return res.status(404).json({error:‘Not found’});
const o = r.rows[0];
await pool.query(“UPDATE orders SET status=‘bill_requested’ WHERE id=$1”,[req.params.orderId]);
if (o.table_id) {
await pool.query(“UPDATE tables SET status=‘bill_requested’ WHERE id=$1”,[o.table_id]);
req.app.get(‘io’).emit(‘table_update’,{id:o.table_id,status:‘bill_requested’});
}
res.json({success:true});
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST close order
router.post(’/:orderId/close’, authMiddleware, async (req,res) => {
const { payment_method } = req.body;
if (!payment_method || ![‘cash’,‘card’].includes(payment_method))
return res.status(400).json({error:‘Payment method required’});
try {
const r = await pool.query(‘SELECT * FROM orders WHERE id=$1’,[req.params.orderId]);
if (!r.rows.length) return res.status(404).json({error:‘Not found’});
const o = r.rows[0];
await pool.query(“UPDATE orders SET status=‘closed’,closed_at=NOW(),payment_method=$1 WHERE id=$2”,[payment_method,req.params.orderId]);
if (o.table_id) {
await pool.query(“UPDATE tables SET status=‘empty’ WHERE id=$1”,[o.table_id]);
req.app.get(‘io’).emit(‘table_update’,{id:o.table_id,status:‘empty’});
}
res.json({success:true});
} catch(e) { res.status(500).json({error:e.message}); }
});

// POST save pending cart (does NOT create order, does NOT mark table busy)
router.post(’/pending-cart’, authMiddleware, async (req, res) => {
const { table_id, items, is_takeaway } = req.body;
try {
if (!items || !items.length) {
if (is_takeaway) await pool.query(‘DELETE FROM pending_carts WHERE waiter_id=$1 AND is_takeaway=true’, [req.user.id]);
else await pool.query(‘DELETE FROM pending_carts WHERE table_id=$1 AND waiter_id=$2’, [table_id, req.user.id]);
return res.json({ success: true, cleared: true });
}
if (is_takeaway) {
const ex = await pool.query(‘SELECT id FROM pending_carts WHERE waiter_id=$1 AND is_takeaway=true’, [req.user.id]);
if (ex.rows.length) await pool.query(‘UPDATE pending_carts SET items=$1,updated_at=NOW() WHERE waiter_id=$2 AND is_takeaway=true’, [JSON.stringify(items), req.user.id]);
else await pool.query(‘INSERT INTO pending_carts(waiter_id,is_takeaway,items) VALUES($1,true,$2)’, [req.user.id, JSON.stringify(items)]);
} else {
const ex = await pool.query(‘SELECT id FROM pending_carts WHERE table_id=$1 AND waiter_id=$2’, [table_id, req.user.id]);
if (ex.rows.length) await pool.query(‘UPDATE pending_carts SET items=$1,updated_at=NOW() WHERE table_id=$2 AND waiter_id=$3’, [JSON.stringify(items), table_id, req.user.id]);
else await pool.query(‘INSERT INTO pending_carts(table_id,waiter_id,is_takeaway,items) VALUES($1,$2,false,$3)’, [table_id, req.user.id, JSON.stringify(items)]);
}
res.json({ success: true });
} catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE pending cart
router.delete(’/pending-cart’, authMiddleware, async (req, res) => {
const { table_id, is_takeaway } = req.query;
try {
if (is_takeaway === ‘true’) await pool.query(‘DELETE FROM pending_carts WHERE waiter_id=$1 AND is_takeaway=true’, [req.user.id]);
else await pool.query(‘DELETE FROM pending_carts WHERE table_id=$1 AND waiter_id=$2’, [table_id, req.user.id]);
res.json({ success: true });
} catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
