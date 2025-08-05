export interface AuthenticatedUser {
  id: string;
  name: string;
  plan: string;
  credits: number;
  enabled: boolean;
}