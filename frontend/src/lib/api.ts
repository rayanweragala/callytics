import axios from 'axios';
import type { AudioFileItem, AudioVoiceItem, FlowDetail, FlowSummary } from '../types';

const api = axios.create({
  baseURL: 'http://localhost:3001',
});

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FlowDetailResponse {
  data: FlowDetail;
}

export interface DeleteFlowResponse {
  data: {
    id: number;
    deleted: true;
  };
}

export interface SaveFlowPayload {
  name: string;
  description?: string;
  slug?: string;
  nodes: Array<{
    nodeKey: string;
    type: string;
    label?: string;
    positionX?: number;
    positionY?: number;
    config?: Record<string, unknown>;
  }>;
  edges: Array<{
    sourceNodeKey: string;
    targetNodeKey: string;
    branchKey?: string;
    condition?: string | null;
  }>;
}

export interface AudioDetailResponse {
  data: AudioFileItem;
}

export interface AudioVoicesResponse {
  data: AudioVoiceItem[];
  total: number;
}

export async function listFlows(page = 1, limit = 5): Promise<PaginatedResponse<FlowSummary>> {
  const response = await api.get<PaginatedResponse<FlowSummary>>('/flows', { params: { page, limit } });
  return response.data;
}

export async function getFlow(id: string): Promise<FlowDetailResponse> {
  const response = await api.get<FlowDetailResponse>(`/flows/${id}`);
  return response.data;
}

export async function createFlow(payload: SaveFlowPayload): Promise<FlowDetailResponse> {
  const response = await api.post<FlowDetailResponse>('/flows', payload);
  return response.data;
}

export async function updateFlow(id: string, payload: SaveFlowPayload): Promise<FlowDetailResponse> {
  const response = await api.put<FlowDetailResponse>(`/flows/${id}`, payload);
  return response.data;
}

export async function deleteFlow(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/flows/${id}`);
  return response.data;
}

export async function listAudio(page = 1, limit = 5): Promise<PaginatedResponse<AudioFileItem>> {
  const response = await api.get<PaginatedResponse<AudioFileItem>>('/audio', { params: { page, limit } });
  return response.data;
}

export async function getAudio(id: number): Promise<AudioDetailResponse> {
  const response = await api.get<AudioDetailResponse>(`/audio/${id}`);
  return response.data;
}

export async function listAudioVoices(): Promise<AudioVoicesResponse> {
  const response = await api.get<AudioVoicesResponse>('/audio/voices');
  return response.data;
}

export async function uploadAudio(file: File, name?: string): Promise<AudioDetailResponse> {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  const response = await api.post<AudioDetailResponse>('/audio/upload', form);
  return response.data;
}

export async function createTts(payload: { name: string; text: string; voice: string }): Promise<AudioDetailResponse> {
  const response = await api.post<AudioDetailResponse>('/audio/tts', payload);
  return response.data;
}

export async function deleteAudio(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/audio/${id}`);
  return response.data;
}
