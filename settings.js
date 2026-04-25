const express = require(‘express’);
const router = express.Router();
const { pool } = require(’../db’);
const { authMiddleware, adminOnly } = require(’../middleware’);

router.get(’/’, authMiddleware, async (req,res) => {
try {
const r = await pool.query(‘SELECT key,value FROM settings ORDER BY key’);
const obj = {}; r.rows.forEach(row => obj[row.key]=row.value);
res.json(obj);
} catch(e) { res.status(500).json({error:e.message}); }
});

router.put(’/’, authMiddleware, adminOnly, async (req,res) => {
try {
for (const [key,value] of Object.entries(req.body))
await pool.query(‘INSERT INTO settings(key,value,updated_at)VALUES($1,$2,NOW())ON CONFLICT(key)DO UPDATE SET value=$2,updated_at=NOW()’,[key,String(value)]);
const r = await pool.query(‘SELECT key,value FROM settings ORDER BY key’);
const obj = {}; r.rows.forEach(row => obj[row.key]=row.value);
res.json(obj);
} catch(e) { res.status(500).json({error:e.message}); }
});

module.exports = router;
