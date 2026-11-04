export const PASSWORD_ROUNDS: 100000
export function validLocalPassword(value: unknown): value is string
export function derivePasswordProof(password: string, saltHex: string): Promise<string>
export function registerPassword(password: string): Promise<{
  passwordProof: string
  passwordSalt: string
  passwordRounds: 100000
}>
export function loginPassword(loginName: string, password: string): Promise<{
  passwordProof: string
}>
