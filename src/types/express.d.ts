declare global {
  namespace Express {
    interface RequestUser {
      id: number;
      role: string;
      memberId: number | null;
    }

    interface Request {
      user?: RequestUser;
    }
  }
}

export {};
