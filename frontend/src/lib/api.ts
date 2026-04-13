import axios from 'axios';
import type { FlowDetail, FlowSummary } from '../types';

const api = axios.create({
  baseURL: 'http://localhost:3001',
});

export interface FlowListResponse {
  data: FlowSummary[];
  total: number;
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
  }>;
}

export async function listFlows(): Promise<FlowListResponse> {
  const response = await api.get<FlowListResponse>('/flows');
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
