import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { buildApiUrl } from '../../../../core/config/api';

export interface AuditLogItem {
  id: number;
  timestamp: string;
  adminName: string;
  adminEmail: string;
  adminRole: string;
  action: string;
  actionLabel: string;
  targetName: string;
  targetEmail: string;
  targetRole: string;
  status: 'Success' | 'Failed';
  reason: string;
  destinationName: string;
  details: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuditLogService {
  constructor(private readonly http: HttpClient) {}

  getLogs(): Observable<AuditLogItem[]> {
    return this.http.get<any>(buildApiUrl('analytics/audit/admin-activity')).pipe(
      map((response) => {
        const actions = response?.actions ?? [];
        if (Array.isArray(actions) && actions.length > 0) {
          return actions
            .map((item: any) => this.mapActivityEntry(item))
            .sort((a: AuditLogItem, b: AuditLogItem) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
        }

        return this.mapSummaryFallback(response);
      })
    );
  }

  getActionLabel(action?: string): string {
    switch ((action ?? '').toUpperCase()) {
      case 'BLOCK_ACCOUNT': return 'Block Account';
      case 'UNBLOCK_ACCOUNT': return 'Unblock Account';
      case 'CREATE_DESTINATION_ADMIN': return 'Create Destination Admin';
      case 'UPDATE_DESTINATION_ADMIN': return 'Update Destination Admin';
      default:
        return this.toTitleCase((action ?? 'Unknown Action').replace(/_/g, ' '));
    }
  }

  getRoleLabel(role?: string): string {
    switch ((role ?? '').toLowerCase()) {
      case 'admin':
      case 'destinationadmin':
        return 'Destination Admin';
      case 'superadmin':
      case 'super_admin':
        return 'Super Admin';
      case 'publisher':
        return 'Publisher';
      case 'tourist':
        return 'Tourist';
      default:
        return role || 'Unknown';
    }
  }

  private mapActivityEntry(item: any): AuditLogItem {
    const action = item.action ?? 'UNKNOWN_ACTION';
    const actionLabel = this.getActionLabel(action);
    const targetRole = this.getRoleLabel(item.targetRole);
    const adminRole = this.getRoleLabel(item.adminRole);
    const reason = item.reason ?? '';
    const destinationName = item.destinationName ?? '';

    return {
      id: item.id ?? 0,
      timestamp: item.timestamp ?? item.createdAt ?? new Date().toISOString(),
      adminName: item.adminName ?? item.adminEmail ?? 'Unknown admin',
      adminEmail: item.adminEmail ?? '',
      adminRole,
      action,
      actionLabel,
      targetName: item.targetName ?? item.targetEmail ?? 'Unknown user',
      targetEmail: item.targetEmail ?? '',
      targetRole,
      status: item.status ?? 'Success',
      reason,
      destinationName,
      details: this.buildDetails(actionLabel, targetRole, item.targetName, destinationName, reason)
    };
  }

  private buildDetails(
    actionLabel: string,
    targetRole: string,
    targetName: string,
    destinationName: string,
    reason: string
  ): string {
    const userPart = `${targetRole} ${targetName ?? 'Unknown user'}`.trim();
    const destinationPart = destinationName ? ` Destination: ${destinationName}.` : '';
    const reasonPart = reason ? ` Reason: ${reason}` : '';
    return `${actionLabel} for ${userPart}.${destinationPart}${reasonPart}`;
  }

  private mapSummaryFallback(response: any): AuditLogItem[] {
    const now = new Date().toISOString();
    const actionItems = (response?.actionBreakdown ?? []).map((item: any, index: number) => {
      const action = item.action ?? 'SUMMARY';
      const actionLabel = this.getActionLabel(action);

      return {
        id: index + 1,
        timestamp: now,
        adminName: 'System summary',
        adminEmail: '',
        adminRole: 'System',
        action,
        actionLabel,
        targetName: actionLabel,
        targetEmail: '',
        targetRole: 'User',
        status: 'Success' as const,
        reason: '',
        destinationName: '',
        details: `Recorded actions: ${item.count ?? 0}`
      };
    });

    return actionItems;
  }

  private toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
