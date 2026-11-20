import { createContext, useContext } from 'react';

// The signed-in employee's role (a DEV account reads as Business Administrator), provided by App. Forms use it to offer
// only what the role may do (e.g. which Other payment kinds); the server enforces the same rules.
export const UserRoleContext = createContext<string>('');
export const useUserRole = () => useContext(UserRoleContext);
