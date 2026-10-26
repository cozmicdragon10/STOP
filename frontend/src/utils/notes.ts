// Group call-in notes are saved as "[Group Call-In Log] (For: YYYY-MM-DD) (Reason: …): …". No "For" date means the day it was submitted.
export const parseGroupCallInNote = (text: string) => {
  const match = /^\[Group Call-In Log\](?: \(For: (\d{4}-\d{2}-\d{2})\))?/.exec(text || '');
  return match ? { forDate: match[1] || null } : null;
};

// Label shown above a case note. Group call-ins read "<date> · Group Call-In"; everything else keeps its category.
export const caseNoteLabel = (note: any) => {
  const groupCallIn = note.category === 'Call-In' ? parseGroupCallInNote(note.comments) : null;
  if (!groupCallIn) return note.category;
  const dateLabel = groupCallIn.forDate ? new Date(`${groupCallIn.forDate}T00:00:00`).toLocaleDateString() : 'Day Of';
  return `${dateLabel} · Group Call-In`;
};

// Optional call-in reasons. Keep in sync with CALL_IN_REASONS in backend/routes/callins.js.
export const CALL_IN_REASONS = ['Routine check-in', 'Missed appointment', 'Reschedule request', 'Transportation issue', 'Work conflict', 'Other'];
