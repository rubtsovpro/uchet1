import axios from 'axios';

const http = axios.create({
  baseURL: '',
  timeout: 30_000,
  withCredentials: true,
});

export const api = {
  async get<T>(url: string): Promise<T> {
    const { data } = await http.get<T>(url);
    return data;
  },
  async post<T>(url: string, body?: unknown): Promise<T> {
    const { data } = await http.post<T>(url, body);
    return data;
  },
};
