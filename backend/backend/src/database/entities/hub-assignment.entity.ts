import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Which hub(s) a DISPATCHER-role user operates. Deliberately reuses the
// existing Role.DISPATCHER (added in Piece 6, "Dispatcher/Admin Role
// Refinement — Phase 2 Prep") rather than introducing the separate
// `dispatchers` table WAZZAR_SYSTEM_ARCHITECTURE.md's Phase 2 pseudocode
// sketches — that table would have created a second, competing notion of
// "dispatcher" alongside the one this backend already has real auth
// (JWT roles, guards, the Piece 8 dispatch queue) built around. A join
// table is also a better fit than the doc's `assigned_hub_ids UUID[]`
// column on a `users`-adjacent row: a user can be assigned/unassigned
// from a hub without rewriting an array, and each assignment gets its
// own timestamp for free.
@Entity('hub_assignments')
export class HubAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hub_id', type: 'uuid' })
  hubId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'assigned_at' })
  assignedAt: Date;
}
