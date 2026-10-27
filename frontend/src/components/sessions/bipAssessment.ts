import { saveOpenIndividualSession } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';

export interface Employee {
  displayname: string;
  role: string;
  active?: boolean;
}

// What was picked in BipAssessmentPicker: choice is a price list entry id, 'none', or '' (nothing yet). fee and name come with an entry.
export interface BipAssessmentChoice {
  choice: string;
  provider: string;
  fee?: number;
  name?: string;
}

// Only active Counselor accounts can be picked; the counselor of the client's group is the default when it is one
export const counselorChoices = (employees: Employee[], groupCounselor?: string | null) => {
  const counselors = Array.from(new Set(employees.filter(e => e.active !== false && e.role === 'Counselor').map(e => e.displayname)))
    .sort((a, b) => a.localeCompare(b));
  const defaultCounselor = counselors.find(c => c.trim().toLowerCase() === String(groupCounselor || '').trim().toLowerCase()) ?? '';
  return { counselors, defaultCounselor };
};

// The first problem with the choice, or null when it can be used
export const bipChoiceProblem = (value: BipAssessmentChoice): string | null => {
  if (!value.choice) return 'Choose an assessment, or None.';
  if (value.choice !== 'none' && !value.provider) return 'Choose the counselor.';
  return null;
};

// Opens the picked assessment on the Assessments & Individuals tab (nothing is charged until it is completed there).
// Returns the assessment's name, or null for None.
export const openBipAssessment = async (clientId: number, value: BipAssessmentChoice, userEmail: string): Promise<string | null> => {
  if (value.choice === 'none') return null;
  await saveOpenIndividualSession({
    client: clientId, category: 'Assessment', sessionTypeId: Number(value.choice), date: todayLocal(), fee: value.fee ?? 0,
    payment: 0, paymentMethod: 'Cash', provider: value.provider, comments: '', paymentComments: '', user: userEmail,
  });
  return value.name ?? 'Assessment';
};
