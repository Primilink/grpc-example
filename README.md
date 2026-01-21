# gRPC Learning Project: Todo + Calendar Microservices

Two Express servers communicating via gRPC to demonstrate internal microservice communication.

## Architecture Overview

```mermaid
flowchart LR
    subgraph TodoService["Todo Service :3001"]
        TE[Express REST API]
        TC[gRPC Client]
    end

    subgraph CalendarService["Calendar Service :3002"]
        CE[Express REST API]
        CS[gRPC Server :50051]
    end

    User -->|POST /todos| TE
    User -->|GET /todos| TE
    TE --> TC
    TC -->|gRPC CreateEvent| CS
    TC -->|gRPC GetEventsByDate| CS
    CS --> CE
    User -->|GET /events| CE
```

## Request Flow: Creating a Todo

```mermaid
sequenceDiagram
    participant User
    participant TodoService as Todo Service<br/>:3001
    participant CalendarService as Calendar Service<br/>:50051 (gRPC) / :3002 (REST)

    User->>TodoService: POST /todos<br/>{"title": "Learn gRPC", "date": "2024-01-26"}

    Note over TodoService: Receives REST request

    TodoService->>CalendarService: gRPC CreateEvent()<br/>{title, description, date}

    Note over CalendarService: Creates event in memory<br/>Generates event-1

    CalendarService-->>TodoService: CreateEventResponse<br/>{event_id: "event-1", success: true}

    Note over TodoService: Creates todo locally<br/>Links calendarEventId

    TodoService-->>User: 201 Created<br/>{"todo": {..., "calendarEventId": "event-1"}}

    User->>CalendarService: GET /events?date=2024-01-26

    CalendarService-->>User: {"events": [{...}]}
```

## Project Structure

```
grpc-example/
├── proto/
│   └── calendar.proto          # gRPC service definition
├── todo-service/
│   ├── package.json
│   ├── index.js                # Express server + gRPC client
│   └── todos.js                # In-memory todo storage
├── calendar-service/
│   ├── package.json
│   ├── index.js                # Express server + gRPC server
│   └── events.js               # In-memory event storage
├── package.json                # Root (pnpm workspaces)
├── pnpm-workspace.yaml
└── README.md
```

## gRPC Service Definition

```mermaid
classDiagram
    class CalendarService {
        +CreateEvent(CreateEventRequest) CreateEventResponse
        +GetEventsByDate(GetEventsRequest) GetEventsResponse
    }

    class CreateEventRequest {
        string title
        string description
        string date
    }

    class CreateEventResponse {
        string event_id
        bool success
    }

    class GetEventsRequest {
        string date
    }

    class GetEventsResponse {
        CalendarEvent[] events
    }

    class CalendarEvent {
        string event_id
        string title
        string description
        string date
    }

    CalendarService ..> CreateEventRequest
    CalendarService ..> CreateEventResponse
    CalendarService ..> GetEventsRequest
    CalendarService ..> GetEventsResponse
    GetEventsResponse *-- CalendarEvent
```

## Getting Started

### Install Dependencies

```bash
pnpm install
```

### Start the Services

```bash
# Terminal 1: Start Calendar Service (gRPC server + REST)
pnpm --filter calendar-service start

# Terminal 2: Start Todo Service (gRPC client + REST)
pnpm --filter todo-service start
```

### Test the Flow

```bash
# Create a todo (syncs to calendar via gRPC)
curl -X POST http://localhost:3001/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn gRPC", "description": "Its gonna be lit", "date": "2026-01-26"}'

# Check calendar events
curl http://localhost:3002/events?date=2026-01-26

# Get all todos
curl http://localhost:3001/todos
```

## API Endpoints

### Todo Service (`:3001`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/todos` | Create a todo (syncs to calendar) |
| GET | `/todos` | List all todos |

### Calendar Service (`:3002`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | List all events |
| GET | `/events?date=YYYY-MM-DD` | Get events for a date |
| GET | `/events/:date` | Get events for a date |

## How gRPC Works Here

```mermaid
flowchart TB
    subgraph Proto["calendar.proto"]
        PD[Service Definition]
    end

    subgraph TodoService["Todo Service"]
        PL1[proto-loader]
        GC[gRPC Client]
    end

    subgraph CalendarService["Calendar Service"]
        PL2[proto-loader]
        GS[gRPC Server]
        SI[Service Implementation]
    end

    Proto -->|loads| PL1
    Proto -->|loads| PL2
    PL1 --> GC
    PL2 --> GS
    GS --> SI
    GC <-->|Binary Protocol<br/>HTTP/2| GS
```

1. **Proto file** defines the contract between services
2. **proto-loader** dynamically loads the `.proto` file at runtime
3. **gRPC client** (Todo Service) makes RPC calls
4. **gRPC server** (Calendar Service) handles RPC calls
5. Communication uses **binary serialization over HTTP/2**

## Dependencies

- `express` - REST API framework
- `@grpc/grpc-js` - gRPC for Node.js (pure JS implementation)
- `@grpc/proto-loader` - Dynamic .proto file loading
