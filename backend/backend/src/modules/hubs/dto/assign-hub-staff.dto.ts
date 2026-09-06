import { IsUUID } from 'class-validator';

export class AssignHubStaffDto {
  @IsUUID()
  userId: string;
}
