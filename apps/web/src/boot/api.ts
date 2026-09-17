import axios from 'axios';

const http = axios.create({
  baseURL: '',
  timeout: 30_000,
  withCredentials: true,
});

function errMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string } | undefined;
    if (data?.error) return String(data.error);
    return e.message || 'Ошибка сети';
  }
  return e instanceof Error ? e.message : 'Ошибка';
}

export const api = {
  async get<T>(url: string): Promise<T> {
    try {
      const { data } = await http.get<T>(url);
      return data;
    } catch (e) {
      throw new Error(errMessage(e));
    }
  },
  async post<T>(url: string, body?: unknown): Promise<T> {
    try {
      const { data } = await http.post<T>(url, body);
      return data;
    } catch (e) {
      throw new Error(errMessage(e));
    }
  },
};
