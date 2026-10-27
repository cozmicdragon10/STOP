import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Paperclip, Pencil, Printer, Trash2, Upload, X } from 'lucide-react';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import {
  ATTACHMENT_MAX_BYTES, deleteClientAttachment, fetchClientAttachment, getClientAttachments, renameClientAttachment,
  uploadClientAttachment,
} from '../../api';
import type { ClientAttachment } from '../../api';

interface Props {
  clientId: number;
  userEmail: string;
  // Business Administrators only
  canDelete: boolean;
  onSuccess: (message: string) => void;
}

// View/Print only open types the browser can show safely; everything else (and anything that could run script,
// like HTML or SVG) is download only.
const VIEWABLE_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'text/plain'];
const canViewAttachment = (a: ClientAttachment) => VIEWABLE_ATTACHMENT_TYPES.includes(a.contenttype);
const formatFileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The Attachments tab of a client's account. Loaded each time it is shown (App remounts it after a discharge saves a
// discharge summary PDF here).
export default function ClientAttachments({ clientId, userEmail, canDelete, onSuccess }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [attachments, setAttachments] = useState<ClientAttachment[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Rename happens in place on the attachment row; Enter saves, Escape cancels
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClientAttachments(clientId)
      .then(list => { if (!cancelled) { setAttachments(list); setStatus('ready'); } })
      .catch(err => { if (!cancelled) { setStatus('error'); setError(errorText(err, 'Could not load attachments.')); } });
    return () => { cancelled = true; };
  }, [clientId]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const tooBig = Array.from(files).filter(f => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig.length > 0) {
      setError(`Larger than 25 MB: ${tooBig.map(f => f.name).join(', ')}`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        await uploadClientAttachment(clientId, file, userEmail);
      }
      setAttachments(await getClientAttachments(clientId));
      onSuccess(files.length === 1 ? `Attached ${files[0].name}.` : `Attached ${files.length} files.`);
    } catch (err) {
      setError(errorText(err, 'Upload failed.'));
      // Some files may have uploaded before the failure
      setAttachments(await getClientAttachments(clientId).catch(() => attachments));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // mode: view opens a new tab, download saves the file, print sends it to a hidden frame's print dialog
  const handleOpen = async (attachment: ClientAttachment, mode: 'view' | 'download' | 'print') => {
    setError('');
    // Opened before the fetch so the browser doesn't treat it as a blocked popup
    const viewer = mode === 'view' ? window.open('', '_blank') : null;
    try {
      const url = URL.createObjectURL(await fetchClientAttachment(attachment));
      if (mode === 'view') {
        if (viewer) viewer.location.href = url; else window.open(url, '_blank');
      } else if (mode === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename;
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
      setError(errorText(err, 'Could not open the attachment.'));
    }
  };

  const startRename = (attachment: ClientAttachment) => {
    setError('');
    setRenamingId(attachment.attachmentid);
    setRenameValue(attachment.filename);
  };
  const handleRename = async (attachment: ClientAttachment) => {
    const name = renameValue.trim();
    if (!name || name === attachment.filename) {
      setRenamingId(null);
      return;
    }
    setRenameSaving(true);
    setError('');
    try {
      const saved = await renameClientAttachment(attachment.attachmentid, name, userEmail);
      setAttachments(prev => prev.map(a => a.attachmentid === saved.attachmentid ? saved : a));
      setRenamingId(null);
    } catch (err) {
      setError(errorText(err, 'Failed to rename the attachment.'));
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDelete = async (attachment: ClientAttachment) => {
    if (!window.confirm(`Delete ${attachment.filename}? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteClientAttachment(attachment.attachmentid, userEmail);
      setAttachments(prev => prev.filter(a => a.attachmentid !== attachment.attachmentid));
    } catch (err) {
      setError(errorText(err, 'Failed to delete the attachment.'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">Save documents to this client's account. Up to 25 MB per file.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleUpload(e.target.files)}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0"
        >
          <Upload size={14} /> {uploading ? 'Uploading...' : 'Add Attachment'}
        </button>
      </div>
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm flex justify-between items-center gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-200"><X size={14} /></button>
        </div>
      )}
      {status === 'loading' && <p className="text-sm text-slate-400">Loading attachments...</p>}
      {status === 'ready' && attachments.length === 0 && (
        <p className="text-sm text-slate-400">No attachments yet.</p>
      )}
      {attachments.map(a => (
        <div key={a.attachmentid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex items-center gap-4">
          <Paperclip size={18} className="text-slate-500 shrink-0" />
          <div className="flex-1 min-w-0">
            {renamingId === a.attachmentid ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  aria-label="New attachment name"
                  value={renameValue}
                  disabled={renameSaving}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename(a);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white text-sm"
                />
                <button type="button" disabled={renameSaving} onClick={() => handleRename(a)} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg text-xs font-semibold">{renameSaving ? 'Saving...' : 'Save'}</button>
                <button type="button" disabled={renameSaving} onClick={() => setRenamingId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold">Cancel</button>
              </div>
            ) : (
              <p className="font-semibold text-white truncate" title={a.filename}>{a.filename}</p>
            )}
            <p className="text-xs text-slate-400 mt-0.5">
              {formatFileSize(a.filesize)} · Added {new Date(a.uploadedon).toLocaleDateString()} by {employeeLabel(a.uploadedby) || 'Unknown'}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {canViewAttachment(a) && (
              <>
                <button type="button" onClick={() => handleOpen(a, 'view')} title="View" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Eye size={13} /> View</button>
                <button type="button" onClick={() => handleOpen(a, 'print')} title="Print" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Printer size={13} /> Print</button>
              </>
            )}
            <button type="button" onClick={() => startRename(a)} title="Rename" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Pencil size={13} /> Rename</button>
            <button type="button" onClick={() => handleOpen(a, 'download')} title="Download" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Download size={13} /> Download</button>
            {canDelete && (
              <button type="button" onClick={() => handleDelete(a)} title="Delete" aria-label={`Delete ${a.filename}`} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20"><Trash2 size={13} /></button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
