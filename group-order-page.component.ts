import { Component, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, of, Subscription, timer } from 'rxjs';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';

interface ConsolidatedDish {
  name: string;
  quantity: number;
}

@Component({
  selector: 'app-group-order-page',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss'
})
export class GroupOrderPageComponent implements OnInit, OnDestroy {
  reservationId: string = '';
  groupId: string = '';
  
  invite: GuestInvite | null = null;
  sessions: GroupSessionsResponse | null = null;
  ownerSessionId: string = '';
  
  isLoading = true;
  errorStatus: number | null = null;
  syncError: boolean = false;
  lastUpdated: Date | null = null;
  
  isSubmitting = false;
  isSubmittedSuccess = false;
  isModalOpen = false;

  private timerSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private groupOrdersService: GroupOrdersService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.reservationId = this.route.snapshot.paramMap.get('reservationId') || '';
    this.loadData();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  loadData(): void {
    this.isLoading = true;
    this.errorStatus = null;

    this.groupOrdersService.getGroupInvite$(this.reservationId).pipe(
      catchError(err => {
        this.errorStatus = err.status || 500;
        this.isLoading = false;
        return of(null);
      })
    ).subscribe(invite => {
      if (!invite) return;
      this.invite = invite;
      this.groupId = invite.GroupReservationId;

      forkJoin({
        sessions: this.groupOrdersService.getSessions$(this.groupId),
        ownerSessionId: this.groupOrdersService.getOwnerSessionId$(this.reservationId),
        status: this.groupOrdersService.getStatus$(this.groupId)
      }).pipe(
        catchError(err => {
          this.errorStatus = err.status || 500;
          this.isLoading = false;
          return of(null);
        })
      ).subscribe(res => {
        this.isLoading = false;
        if (res) {
          this.sessions = res.sessions;
          this.ownerSessionId = res.ownerSessionId;
          this.lastUpdated = new Date();
          this.startPolling();
        }
      });
    });
  }

  startPolling(): void {
    this.stopPolling();
    this.timerSub = timer(15000, 15000).subscribe(() => {
      this.refreshData(true);
    });
  }

  stopPolling(): void {
    if (this.timerSub) {
      this.timerSub.unsubscribe();
      this.timerSub = undefined;
    }
  }

  refreshData(silent = false): void {
    if (!this.groupId) return;

    this.groupOrdersService.getSessions$(this.groupId, { silent }).pipe(
      catchError(() => {
        this.syncError = true;
        return of(null);
      })
    ).subscribe(sessions => {
      if (sessions) {
        this.sessions = sessions;
        this.syncError = false;
        this.lastUpdated = new Date();
      }
    });
  }

  get participants() {
    return this.sessions?.participants || [];
  }

  get submittedParticipants() {
    return this.participants.filter(p => p.isSubmitted);
  }

  get unsubmittedCount(): number {
    return this.participants.filter(p => !p.isSubmitted).length;
  }

  get grandTotal(): number {
    return this.submittedParticipants.reduce((sum: number, p) => {
      const pTotal = p.items?.reduce((itemSum: number, item: any) => itemSum + item.dish.price * item.quantity, 0) || 0;
      return sum + pTotal;
    }, 0);
  }

  get consolidatedDishes(): ConsolidatedDish[] {
    const dishMap = new Map<string, { name: string; quantity: number }>();

    for (const p of this.submittedParticipants) {
      if (!p.items) continue;
      for (const item of p.items) {
        const existing = dishMap.get(item.dish.id);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          dishMap.set(item.dish.id, { name: item.dish.name, quantity: item.quantity });
        }
      }
    }

    return Array.from(dishMap.values());
  }

  get hasDishes(): boolean {
    return this.participants.some(p => p.items && p.items.length > 0);
  }

  get canSubmit(): boolean {
    return this.submittedParticipants.length > 0 && !this.isSubmittedSuccess;
  }

  openSubmitModal(): void {
    if (this.canSubmit) {
      this.isModalOpen = true;
    }
  }

  closeSubmitModal(): void {
    this.isModalOpen = false;
  }

  confirmSubmit(): void {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    this.groupOrdersService.submit$(this.groupId, this.reservationId).pipe(
      catchError(() => {
        this.isSubmitting = false;
        this.toastService.error('Failed to submit pre-order');
        return of(null);
      })
    ).subscribe(res => {
      this.isSubmitting = false;
      if (res !== null) {
        this.isSubmittedSuccess = true;
        this.isModalOpen = false;
        this.stopPolling();
      }
    });
  }
}