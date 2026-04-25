const express = require(‘express’);
const router = express.Router();
const { pool } = require(’../db’);
const { authMiddleware, adminOnly } = require(’../middleware’);

router.get(’/categories’, authMiddleware, async (req,res) => {
try { res.json((await pool.query(‘SELECT * FROM categories WHERE active=true ORDER BY sort_order,name’)).rows); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.post(’/categories’, authMiddleware, adminOnly, async (req,res) => {
try { res.json((await pool.query(‘INSERT INTO categories(name,color)VALUES($1,$2)RETURNING *’,[req.body.name,req.body.color||’#2563eb’])).rows[0]); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.put(’/categories/:id’, authMiddleware, adminOnly, async (req,res) => {
try { res.json((await pool.query(‘UPDATE categories SET name=$1,color=$2 WHERE id=$3 RETURNING *’,[req.body.name,req.body.color||’#2563eb’,req.params.id])).rows[0]); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.delete(’/categories/:id’, authMiddleware, adminOnly, async (req,res) => {
try { await pool.query(‘UPDATE categories SET active=false WHERE id=$1’,[req.params.id]); res.json({success:true}); }
catch(e) { res.status(500).json({error:e.message}); }
});

router.get(’/subcategories/:catId’, authMiddleware, async (req,res) => {
try { res.json((await pool.query(‘SELECT * FROM subcategories WHERE category_id=$1 AND active=true ORDER BY sort_order,name’,[req.params.catId])).rows); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.post(’/subcategories’, authMiddleware, adminOnly, async (req,res) => {
try { res.json((await pool.query(‘INSERT INTO subcategories(category_id,name)VALUES($1,$2)RETURNING *’,[req.body.category_id,req.body.name])).rows[0]); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.put(’/subcategories/:id’, authMiddleware, adminOnly, async (req,res) => {
try { res.json((await pool.query(‘UPDATE subcategories SET name=$1 WHERE id=$2 RETURNING *’,[req.body.name,req.params.id])).rows[0]); }
catch(e) { res.status(500).json({error:e.message}); }
});
router.delete(’/subcategories/:id’, authMiddleware, adminOnly, async (req,res) => {
try { await pool.query(‘UPDATE subcategories SET active=false WHERE id=$1’,[req.params.id]); res.json({success:true}); }
catch(e) { res.status(500).json({error:e.message}); }
});

router.get(’/products’, authMiddleware, async (req,res) => {
const { category_id, subcategory_id, all } = req.query;
try {
let q, params;
if (subcategory_id) {
q=‘SELECT * FROM products WHERE subcategory_id=$1 AND active=true ORDER BY sort_order,name’;
params=[subcategory_id];
} else if (category_id && all===‘true’) {
q=‘SELECT * FROM products WHERE category_id=$1 AND active=true ORDER BY sort_order,name’;
params=[category_id];
} else if (category_id) {
q=‘SELECT * FROM products WHERE category_id=$1 AND subcategory_id IS NULL AND active=true ORDER BY sort_order,name’;
params=[category_id];
} else {
q=‘SELECT * FROM products WHERE active=true ORDER BY sort_order,name’;
params=[];
}
res.json((await pool.query(q,params)).rows);
} catch(e) { res.status(500).json({error:e.message}); }
});
router.post(’/products’, authMiddleware, adminOnly, async (req,res) => {
const { category_id,subcategory_id,name,price,description,color,product_type } = req.body;
try {
res.json((await pool.query(
‘INSERT INTO products(category_id,subcategory_id,name,price,description,color,product_type)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *’,
[category_id||null,subcategory_id||null,name,price,description||null,color||’#2563eb’,product_type||‘food’]
)).rows[0]);
} catch(e) { res.status(500).json({error:e.message}); }
});
router.put(’/products/:id’, authMiddleware, adminOnly, async (req,res) => {
const { name,price,description,color,product_type } = req.body;
try {
res.json((await pool.query(
‘UPDATE products SET name=$1,price=$2,description=$3,color=$4,product_type=$5 WHERE id=$6 RETURNING *’,
[name,price,description||null,color||’#2563eb’,product_type||‘food’,req.params.id]
)).rows[0]);
} catch(e) { res.status(500).json({error:e.message}); }
});
router.delete(’/products/:id’, authMiddleware, adminOnly, async (req,res) => {
try { await pool.query(‘UPDATE products SET active=false WHERE id=$1’,[req.params.id]); res.json({success:true}); }
catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
