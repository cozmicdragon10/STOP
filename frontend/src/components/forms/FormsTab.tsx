import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText, Pencil, Printer, Trash2, Upload } from 'lucide-react';
import { ATTACHMENT_MAX_BYTES, deleteLibraryDocument, fetchLibraryDocument, getLibraryDocuments, updateLibraryDocument, uploadLibraryDocument } from '../../api';
import type { LibraryDocument } from '../../api';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';

interface Props {
  role: string;
  onSuccess: (message: string) => void;
}

// View/Print only open types the browser can show safely; everything else (Word files, and anything that could run
// script, like HTML or SVG) is download only. Matches the client Attachments tab.
const VIEWABLE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'text/plain'];
const canView = (d: LibraryDocument) => VIEWABLE_TYPES.includes(d.contenttype);
// Offered when uploading; any other category can be typed
const SUGGESTED_CATEGORIES = ['Intake Paperwork', 'BIP', 'SO', 'Polygraph', 'Releases & Consents', 'General'];
const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The Forms page: blank forms and documents to print in the field or at an office for a client to sign or fill out.
// Everyone can open, print, and download; Business Administrators and Office Admins upload and organize; only
// Business Administrators delete (the server checks each).
export default function FormsTab({ role, onSuccess }: Props) {
  const employeeLabel = useEmployeeLabel();
  const canManage = role === 'Business Administrator' || role === 'Office Admin';
  const canDelete = role === 'Business Administrator';
  const [docs, setDocs] = useState<LibraryDocument[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Intake Paperwork');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-place edit of one document's name, category, and description
  const [editing, setEditing] = useState<{ id: number; fileName: string; category: string; description: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLibraryDocuments()
      .then(list => { if (!cancelled) { setDocs(list); setStatus('ready'); } })
      .catch(err => { if (!cancelled) { setStatus('error'); setError(errorText(err, 'Could not load the forms.')); } });
    return () => { cancelled = true; };
  }, []);

  const categories = Array.from(new Set([...SUGGESTED_CATEGORIES, ...docs.map(d => d.category)])).sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();
  const shown = docs.filter(d => !needle || [d.filename, d.category, d.description].some(v => String(v || '').toLowerCase().includes(needle)));
  const byCategory = new Map<string, LibraryDocument[]>();
  for (const d of [...shown].sort((a, b) => a.category.localeCompare(b.category) || a.filename.localeCompare(b.filename))) {
    if (!byCategory.has(d.category)) byCategory.set(d.category, []);
    byCategory.get(d.category)!.push(d);
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const tooBig = Array.from(files).filter(f => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig.length > 0) { setError(`Larger than 25 MB: ${tooBig.map(f => f.name).join(', ')}`); return; }
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) await uploadLibraryDocument(file, uploadCategory);
      setDocs(await getLibraryDocuments());
      onSuccess(files.length === 1 ? `Added ${files[0].name} to ${uploadCategory.trim() || 'General'}.` : `Added ${files.length} forms to ${uploadCategory.trim() || 'General'}.`);
    } catch (err) {
      setError(errorText(err, 'Upload failed.'));
      // Some files may have uploaded before the failure
      setDocs(await getLibraryDocuments().catch(() => docs));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // mode: view opens a new tab, download saves the file, print sends it to a hidden frame's print dialog
  const handleOpen = async (doc: LibraryDocument, mode: 'view' | 'download' | 'print') => {
    setError('');
    // Opened before the fetch so the browser doesn't treat it as a blocked popup
    const viewer = mode === 'view' ? window.open('', '_blank') : null;
    try {
      const url = URL.createObjectURL(await fetchLibraryDocument(doc));
      if (mode === 'view') {
        if (viewer) viewer.location.href = url; else window.open(url, '_blank');
      } else if (mode === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.filename;
        link.click();
      } else {
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 60000);
        };
        frame.src = url;
        document.body.appendChild(frame);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      viewer?.close();
      setError(errorText(err, 'Could not open the document.'));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.fileName.trim()) { setError('Enter a name for the document.'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = await updateLibraryDocument(editing.id, { fileName: editing.fileName, category: editing.category, description: editing.description });
      setDocs(prev => prev.map(d => (d.documentid === saved.documentid ? saved : d)));
      setEditing(null);
    } catch (err) {
      setError(errorText(err, 'Failed to save the document.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (doc: LibraryDocument) => {
    if (!window.confirm(`Delete ${doc.filename} from the forms library? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteLibraryDocument(doc.documentid);
      setDocs(prev => prev.filter(d => d.documentid !== doc.documentid));
      onSuccess(`Deleted ${doc.filename}.`);
    } catch (err) {
      setError(errorText(err, 'Failed to delete the document.'));
    }
  };

  const input = 'bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs';
  const iconButton = 'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="max-w-5xl mx-auto bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><FileText size={18} className="text-blue-400" /> Forms</h2>
          <p className="text-xs text-slate-400 mt-0.5">Blank forms and documents to print for a client to sign or fill out, like intake paperwork.</p>
        </div>
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search forms…" className={`${input} w-64 max-w-full`} />
      </div>

      {canManage && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">Category
            <input list="form-categories" value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} placeholder="General" className={`${input} block mt-1 w-56`} />
          </label>
          <datalist id="form-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)} />
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="h-[34px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Forms'}
          </button>
          <p className="text-[11px] text-slate-500 basis-full">Up to 25 MB each. PDFs print straight from here; Word and other files download to print.</p>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}
      {status === 'loading' && <p className="text-sm text-slate-500 text-center py-6">Loading…</p>}
      {status === 'ready' && docs.length === 0 && (
        <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-6 text-center">
          No forms yet.{canManage ? ' Upload blank forms above to keep them here for printing.' : ' A Business Administrator or Office Admin can add them.'}
        </p>
      )}
      {status === 'ready' && docs.length > 0 && shown.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No forms match your search.</p>}

      {Array.from(byCategory.entries()).map(([category, list]) => (
        <div key={category} className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{category} <span className="text-slate-600">({list.length})</span></p>
          {list.map(d => (
            <div key={d.documentid} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              {editing?.id === d.documentid ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2">
                    <input value={editing.fileName} onChange={e => setEditing({ ...editing, fileName: e.target.value })} aria-label="Name" className={input} />
                    <input list="form-categories" value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })} aria-label="Category" className={input} />
                  </div>
                  <input value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="Description (optional), e.g. when to use it" maxLength={500} className={`${input} w-full`} />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(null)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
                    <button type="button" disabled={saving} onClick={saveEdit} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">{saving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{d.filename}</p>
                    {d.description && <p className="text-xs text-slate-400">{d.description}</p>}
                    <p className="text-[11px] text-slate-500">{formatFileSize(d.filesize)} · Added {new Date(d.uploadedon).toLocaleDateString()}{d.uploadedby ? ` by ${employeeLabel(d.uploadedby)}` : ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button type="button" disabled={!canView(d)} title={canView(d) ? 'Open in a new tab' : 'This file type downloads instead'} onClick={() => handleOpen(d, 'view')} className={iconButton}><Eye size={13} /> View</button>
                    <button type="button" disabled={!canView(d)} title={canView(d) ? 'Print' : 'Download this file type to print it'} onClick={() => handleOpen(d, 'print')} className={iconButton}><Printer size={13} /> Print</button>
                    <button type="button" onClick={() => handleOpen(d, 'download')} className={iconButton}><Download size={13} /> Download</button>
                    {canManage && <button type="button" onClick={() => { setError(''); setEditing({ id: d.documentid, fileName: d.filename, category: d.category, description: d.description || '' }); }} className={iconButton}><Pencil size={13} /> Edit</button>}
                    {canDelete && <button type="button" onClick={() => handleDelete(d)} className={`${iconButton} hover:bg-red-600 hover:border-red-600`}><Trash2 size={13} /></button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
