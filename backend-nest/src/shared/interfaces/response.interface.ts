export interface answerResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  metadata?: {
    searchResults?: any[];
    totalFound?: number;
    queryTime?: number;
  };
}
