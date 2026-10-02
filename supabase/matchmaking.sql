-- Matchmaking queue table for random chat pairing
create table if not exists public.matchmaking_queue (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  status text default 'waiting' check (status in ('waiting', 'matched', 'left')),
  matched_with uuid references auth.users on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.matchmaking_queue enable row level security;

create policy "Users can view queue entries" on public.matchmaking_queue
  for select using (true);

create policy "Users can insert their own queue entry" on public.matchmaking_queue
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own queue entry" on public.matchmaking_queue
  for update using (auth.uid() = user_id);

create policy "Users can delete their own queue entry" on public.matchmaking_queue
  for delete using (auth.uid() = user_id);