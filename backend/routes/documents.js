const express = require('express');
const { logAction, pool } = require('../db');
const { requireRole } = require('../lib/auth');

const router = express.Router();

// --- FORMS LIBRARY ---
// Blank forms and documents for printing (intake paperwork and the like). Every logged-in employee can list, open,
// print, and download them; Business Administrators and Office Admins add and organize them; only Business
// Administrators delete. Uploads arrive as raw bytes with the name, type, and category in headers, like client attachments.
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const LIST_COLUMNS = 'DocumentId, FileName, ContentType, FileSize, Category, Description, UploadedBy, UploadedOn';
const canManage = requireRole('Business Administrator', 'Office Admin');
const cleanCategory = (value) => String(value || '').trim().slice(0, 100) || 'General';

router.get('/api/documents', async (req, res) => {
    try {
        const result = await pool.query(`SELECT ${LIST_COLUMNS} FROM LibraryDocuments ORDER BY Category, FileName`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/documents', canManage, express.raw({ type: 'application/octet-stream', limit: DOCUMENT_MAX_BYTES }), async (req, res) => {
    try {
        const user = req.user.employeeemail;
        const fileName = decodeURIComponent(req.get('X-File-Name') || '').trim();
        const contentType = req.get('X-File-Type') || 'application/octet-stream';
        const category = cleanCategory(decodeURIComponent(req.get('X-Category') || ''));
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Choose a file to upload.' });
        if (!fileName) return res.status(400).json({ error: 'The file needs a name.' });
        const result = await pool.query(
            `INSERT INTO LibraryDocuments (FileName, ContentType, FileSize, Data, Category, UploadedBy)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${LIST_COLUMNS}`,
            [fileName.slice(0, 255), contentType.slice(0, 255), req.body.length, req.body, category, user]
        );
        await logAction(user, 'Add Form', `${category}: ${fileName}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Always sent as a download with nosniff; the browser decides whether to show it from the blob it builds
router.get('/api/documents/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT FileName, ContentType, Data FROM LibraryDocuments WHERE DocumentId = $1', [req.params.id]);
        const file = result.rows[0];
        if (!file) return res.status(404).json({ error: 'Document not found.' });
        res.set({
            'Content-Type': file.contenttype,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            'X-Content-Type-Options': 'nosniff',
        });
        res.send(file.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rename, recategorize, or describe. The original extension is kept so downloads still open in the right program.
router.patch('/api/documents/:id', canManage, async (req, res) => {
    try {
        const user = req.user.employeeemail;
        const beforeRes = await pool.query('SELECT FileName, Category, Description FROM LibraryDocuments WHERE DocumentId = $1', [req.params.id]);
        const before = beforeRes.rows[0];
        if (!before) return res.status(404).json({ error: 'Document not found.' });
        let fileName = req.body.fileName === undefined ? before.filename : String(req.body.fileName).trim();
        if (!fileName) return res.status(400).json({ error: 'Enter a name for the document.' });
        const extension = before.filename.match(/\.[^.\s]{1,10}$/)?.[0];
        if (extension && !fileName.toLowerCase().endsWith(extension.toLowerCase())) fileName += extension;
        const category = req.body.category === undefined ? before.category : cleanCategory(req.body.category);
        const description = req.body.description === undefined ? before.description : (String(req.body.description).trim().slice(0, 500) || null);
        const result = await pool.query(
            `UPDATE LibraryDocuments SET FileName = $1, Category = $2, Description = $3 WHERE DocumentId = $4 RETURNING ${LIST_COLUMNS}`,
            [fileName.slice(0, 255), category, description, req.params.id]
        );
        await logAction(user, 'Change Form', `${before.category}: ${before.filename} to ${category}: ${result.rows[0].filename}`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/documents/:id', requireRole('Business Administrator'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM LibraryDocuments WHERE DocumentId = $1 RETURNING FileName, Category', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found.' });
        await logAction(req.user.employeeemail, 'Delete Form', `${result.rows[0].category}: ${result.rows[0].filename}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
