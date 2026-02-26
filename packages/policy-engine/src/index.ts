// Policy Engine - Permission rules and approval workflows
// PR-10 and PR-14 will implement full policy evaluation

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ActionType =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'terminal_execute'
  | 'git_commit'
  | 'git_push'
  | 'network_request';

export interface PolicyRule {
  id: string;
  name: string;
  actionType: ActionType;
  condition: RuleCondition;
  decision: 'allow' | 'deny' | 'require_approval';
  riskLevel: RiskLevel;
}

export interface RuleCondition {
  pathPattern?: string;
  commandPattern?: string;
  maxSize?: number;
  allowedHosts?: string[];
}

export interface ApprovalRequest {
  id: string;
  actionType: ActionType;
  description: string;
  riskLevel: RiskLevel;
  details: unknown;
  requestedAt: Date;
}

export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  reason?: string;
  scope: 'once' | 'session' | 'always';
  decidedAt: Date;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private approvals: Map<string, ApprovalDecision> = new Map();

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  evaluate(actionType: ActionType, details: unknown): EvaluationResult {
    // Placeholder - PR-10 implementation
    // Default deny for high-risk actions
    const highRiskActions: ActionType[] = ['file_write', 'file_delete', 'terminal_execute', 'git_push'];

    if (highRiskActions.includes(actionType)) {
      return {
        decision: 'require_approval',
        riskLevel: 'high',
        reason: `${actionType} requires explicit approval`
      };
    }

    return {
      decision: 'allow',
      riskLevel: 'low'
    };
  }

  recordApproval(decision: ApprovalDecision): void {
    this.approvals.set(decision.requestId, decision);
  }

  getApproval(requestId: string): ApprovalDecision | undefined {
    return this.approvals.get(requestId);
  }
}

export interface EvaluationResult {
  decision: 'allow' | 'deny' | 'require_approval';
  riskLevel: RiskLevel;
  reason?: string;
  matchedRule?: string;
}