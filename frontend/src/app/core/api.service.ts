import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ClaimDetail, ClaimDocument, ClaimFilter, ClaimSummary, CreateClaimBody, Dashboard, NotificationItem, Paged,
  SystemInfo, User, Workload,
} from './models';

const API = '/api';
/** Background polling must not spam the user with error toasts. */
const QUIET = { headers: new HttpHeaders({ 'X-Silent': '1' }) };

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // session
  users(): Observable<User[]> { return this.http.get<User[]>(`${API}/users`); }
  login(email: string): Observable<User> { return this.http.post<User>(`${API}/auth/login`, { email }); }
  systemInfo(): Observable<SystemInfo> { return this.http.get<SystemInfo>(`${API}/system/info`, QUIET); }
  officers(): Observable<User[]> { return this.http.get<User[]>(`${API}/officers`); }

  // claims
  listClaims(f: ClaimFilter): Observable<Paged<ClaimSummary>> {
    return this.http.get<Paged<ClaimSummary>>(`${API}/claims`, { params: this.params(f) });
  }
  myClaims(f: ClaimFilter): Observable<Paged<ClaimSummary>> {
    return this.http.get<Paged<ClaimSummary>>(`${API}/claims/mine`, { params: this.params(f) });
  }
  claim(id: number, quiet = false): Observable<ClaimDetail> {
    return this.http.get<ClaimDetail>(`${API}/claims/${id}`, quiet ? QUIET : {});
  }
  createClaim(body: CreateClaimBody): Observable<ClaimDetail> { return this.http.post<ClaimDetail>(`${API}/claims`, body); }

  assign(id: number, officerId: number | null): Observable<ClaimDetail> { return this.post(id, 'assign', { officerId }); }
  requestInfo(id: number, message: string): Observable<ClaimDetail> { return this.post(id, 'request-info', { message }); }
  provideInfo(id: number, response: string): Observable<ClaimDetail> { return this.post(id, 'provide-info', { response }); }
  uploadDocument(id: number, file: File): Observable<ClaimDocument> {
    const body = new FormData(); body.append('file', file, file.name);
    return this.http.post<ClaimDocument>(`${API}/claims/${id}/documents`, body);
  }
  downloadDocument(id: number, documentId: number): Observable<Blob> {
    return this.http.get(`${API}/claims/${id}/documents/${documentId}`, { responseType: 'blob' });
  }
  assess(id: number, assessedAmount: number, comment: string): Observable<ClaimDetail> { return this.post(id, 'assess', { assessedAmount, comment }); }
  approve(id: number, approvedAmount: number, comment: string): Observable<ClaimDetail> { return this.post(id, 'approve', { approvedAmount, comment }); }
  reject(id: number, reason: string): Observable<ClaimDetail> { return this.post(id, 'reject', { reason }); }
  reopen(id: number): Observable<ClaimDetail> { return this.post(id, 'reopen', {}); }
  settle(id: number): Observable<ClaimDetail> { return this.post(id, 'settle', {}); }
  withdraw(id: number): Observable<ClaimDetail> { return this.post(id, 'withdraw', {}); }
  addNote(id: number, text: string): Observable<ClaimDetail> { return this.post(id, 'notes', { text }); }

  // notifications
  notifications(): Observable<NotificationItem[]> { return this.http.get<NotificationItem[]>(`${API}/notifications`, QUIET); }
  markRead(id: number): Observable<void> { return this.http.post<void>(`${API}/notifications/${id}/read`, {}); }
  markAllRead(): Observable<void> { return this.http.post<void>(`${API}/notifications/read-all`, {}); }

  // insight
  workload(): Observable<Workload> { return this.http.get<Workload>(`${API}/workload`); }
  dashboard(quiet = false): Observable<Dashboard> { return this.http.get<Dashboard>(`${API}/dashboard`, quiet ? QUIET : {}); }

  private post(id: number, action: string, body: object): Observable<ClaimDetail> {
    return this.http.post<ClaimDetail>(`${API}/claims/${id}/${action}`, body);
  }

  private params(f: ClaimFilter): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== null && v !== '' && v !== false) p = p.set(k, String(v));
    }
    return p;
  }
}
