export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string;
  anonymousName: string;
  avatar: string | null;
  role: 'USER' | 'COUNSELOR' | 'ADMIN';
  createdAt: string;
  counselorProfile?: CounselorProfile;
}

export interface CounselorProfile {
  id: string;
  userId: string;
  realName: string;
  certificateNumber: string;
  expertise: string[];
  introduction: string | null;
  hourlyRate: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface Tag {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
}

export interface Post {
  id: string;
  userId: string;
  title: string;
  content: string;
  isAnonymous: boolean;
  displayName: string;
  viewCount: number;
  likeCount: number;
  replyCount: number;
  createdAt: string;
  user: User;
  tags: { tag: Tag }[];
  replies?: Reply[];
}

export interface Reply {
  id: string;
  postId: string;
  userId: string;
  content: string;
  isCounselorReply: boolean;
  createdAt: string;
  user: User;
}

export interface Schedule {
  id: string;
  counselorId: string;
  date: string;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  counselorId: string;
  scheduleId: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  price: number;
  paymentStatus: boolean;
  meetingLink: string | null;
  createdAt: string;
  schedule: Schedule;
  client: User;
  counselor: User;
}

export interface SupportGroup {
  id: string;
  name: string;
  description: string;
  topic: string;
  maxMembers: number;
  status: 'ACTIVE' | 'FULL' | 'CLOSED';
  meetingTime: string | null;
  meetingFrequency: string | null;
  createdBy: string;
  createdAt: string;
  members: GroupMember[];
  messages?: GroupMessage[];
  _count?: { members: number };
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  joinedAt: string;
  role: string;
  user: User;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: User;
}

export interface Favorite {
  id: string;
  userId: string;
  postId: string;
  createdAt: string;
  post: Post;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
}

export type CrisisAlertStatus = 'PENDING' | 'FOLLOWING' | 'CLOSED' | 'FALSE_ALARM';

export interface CrisisAlert {
  id: string;
  userId: string;
  postId: string | null;
  keyword: string;
  content: string;
  status: CrisisAlertStatus;
  isResolved: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  interventionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  user: User;
  claimedByUser?: Pick<User, 'id' | 'username' | 'nickname'> | null;
}
