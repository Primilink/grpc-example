# gRPC Learning Project: Todo + Calendar + Storage Microservices

Three Express servers communicating via gRPC to demonstrate internal microservice communication, including **streaming RPCs** for file uploads/downloads.

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

    subgraph StorageService["Storage Service :3003"]
        SE[Express REST API]
        SS[gRPC Server :50052]
    end

    User -->|POST /todos| TE
    User -->|GET /todos| TE
    User -->|POST /todos/:id/attachment| TE
    User -->|GET /todos/:id/attachment| TE
    TE --> TC
    TC -->|gRPC CreateEvent| CS
    TC -->|gRPC UploadFile ⚡stream| SS
    TC -->|gRPC DownloadFile ⚡stream| SS
    CS --> CE
    SS --> SE
    User -->|GET /events| CE
    User -->|GET /files| SE
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

## Request Flow: Uploading an Attachment (Client Streaming)

```mermaid
sequenceDiagram
    participant User
    participant TodoService as Todo Service<br/>:3001
    participant StorageService as Storage Service<br/>:50052 (gRPC) / :3003 (REST)

    User->>TodoService: POST /todos/todo-1/attachment<br/>[binary file data]

    Note over TodoService: Receives file via REST

    TodoService->>StorageService: gRPC UploadFile() stream start
    TodoService->>StorageService: FileChunk {data, filename, mimeType}
    TodoService->>StorageService: FileChunk {data}
    TodoService->>StorageService: FileChunk {data}
    TodoService->>StorageService: stream end

    Note over StorageService: Reassembles chunks<br/>Stores in memory

    StorageService-->>TodoService: UploadResponse<br/>{file_id: "file-1", size: 1234}

    Note over TodoService: Updates todo.fileId

    TodoService-->>User: 201 Created<br/>{"fileId": "file-1", "size": 1234}
```

## Request Flow: Downloading an Attachment (Server Streaming)

```mermaid
sequenceDiagram
    participant User
    participant TodoService as Todo Service<br/>:3001
    participant StorageService as Storage Service<br/>:50052 (gRPC) / :3003 (REST)

    User->>TodoService: GET /todos/todo-1/attachment

    Note over TodoService: Looks up todo.fileId

    TodoService->>StorageService: gRPC DownloadFile({file_id})

    StorageService-->>TodoService: FileChunk {data, filename, mimeType}
    StorageService-->>TodoService: FileChunk {data}
    StorageService-->>TodoService: FileChunk {data}
    StorageService-->>TodoService: stream end

    Note over TodoService: Reassembles chunks

    TodoService-->>User: 200 OK<br/>[binary file data]
```

## Project Structure

```
grpc-example/
├── proto/
│   ├── calendar.proto          # Calendar gRPC service definition
│   └── storage.proto           # Storage gRPC service (streaming!)
├── todo-service/
│   ├── package.json
│   ├── index.js                # Express server + gRPC clients
│   └── todos.js                # In-memory todo storage
├── calendar-service/
│   ├── package.json
│   ├── index.js                # Express server + gRPC server
│   └── events.js               # In-memory event storage
├── storage-service/
│   ├── package.json
│   ├── index.js                # Express server + gRPC streaming server
│   └── files.js                # In-memory file storage
├── package.json                # Root (pnpm workspaces)
├── pnpm-workspace.yaml
└── README.md
```

## gRPC Service Definitions

### CalendarService

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

### StorageService (Streaming RPCs)

```mermaid
classDiagram
    class StorageService {
        +UploadFile(stream FileChunk) UploadResponse
        +DownloadFile(DownloadRequest) stream FileChunk
    }

    class FileChunk {
        bytes data
        string filename
        string mime_type
    }

    class UploadResponse {
        string file_id
        string filename
        int64 size
        bool success
    }

    class DownloadRequest {
        string file_id
    }

    StorageService ..> FileChunk : client streaming
    StorageService ..> UploadResponse
    StorageService ..> DownloadRequest
    StorageService ..> FileChunk : server streaming
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

# Terminal 2: Start Storage Service (gRPC streaming server + REST)
pnpm --filter storage-service start

# Terminal 3: Start Todo Service (gRPC client + REST)
pnpm --filter todo-service start
```

### Test the Flow

```bash
# Create a todo (syncs to calendar via gRPC)
curl -X POST http://localhost:3001/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "Learn gRPC Streaming", "description": "Its gonna be lit", "date": "2026-01-26"}'

# Check calendar events
curl http://localhost:3002/events?date=2026-01-26

# Get all todos
curl http://localhost:3001/todos

# Upload an attachment to todo (uses gRPC client streaming)
echo "Hello, this is my report content!" > /tmp/report.txt
curl -X POST http://localhost:3001/todos/todo-1/attachment \
  -H "Content-Type: text/plain" \
  -H "X-Filename: report.txt" \
  --data-binary @/tmp/report.txt

# Check files in storage service
curl http://localhost:3003/files

# Download attachment via todo service (uses gRPC server streaming)
curl http://localhost:3001/todos/todo-1/attachment --output /tmp/downloaded.txt
cat /tmp/downloaded.txt
```

## API Endpoints

### Todo Service (`:3001`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/todos` | Create a todo (syncs to calendar) |
| GET | `/todos` | List all todos |
| POST | `/todos/:id/attachment` | Upload attachment (streams to storage) |
| GET | `/todos/:id/attachment` | Download attachment (streams from storage) |

### Calendar Service (`:3002`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events` | List all events |
| GET | `/events?date=YYYY-MM-DD` | Get events for a date |
| GET | `/events/:date` | Get events for a date |

### Storage Service (`:3003`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/files` | List all stored files (metadata only) |
| GET | `/files/:id` | Get file metadata |
| GET | `/files/:id/download` | Download file directly |

## How gRPC Works Here

```mermaid
flowchart TB
    subgraph Protos["Proto Files"]
        CP[calendar.proto]
        SP[storage.proto]
    end

    subgraph TodoService["Todo Service"]
        PL1[proto-loader]
        GCC[Calendar gRPC Client]
        GSC[Storage gRPC Client]
    end

    subgraph CalendarService["Calendar Service"]
        PL2[proto-loader]
        GS1[gRPC Server]
        SI1[Service Implementation]
    end

    subgraph StorageService["Storage Service"]
        PL3[proto-loader]
        GS2[gRPC Streaming Server]
        SI2[Streaming Handlers]
    end

    CP -->|loads| PL1
    CP -->|loads| PL2
    SP -->|loads| PL1
    SP -->|loads| PL3
    PL1 --> GCC
    PL1 --> GSC
    PL2 --> GS1
    PL3 --> GS2
    GS1 --> SI1
    GS2 --> SI2
    GCC <-->|Binary Protocol<br/>HTTP/2| GS1
    GSC <-->|Streaming<br/>HTTP/2| GS2
```

1. **Proto files** define the contract between services
2. **proto-loader** dynamically loads the `.proto` files at runtime
3. **gRPC clients** (Todo Service) make RPC calls
4. **gRPC servers** (Calendar & Storage) handle RPC calls
5. **Streaming RPCs** allow chunked file transfer over HTTP/2
6. Communication uses **binary serialization over HTTP/2**

## gRPC Streaming Types

This project demonstrates two streaming patterns:

| Type | Example | Description |
|------|---------|-------------|
| **Client Streaming** | `UploadFile` | Client sends multiple chunks, server responds once |
| **Server Streaming** | `DownloadFile` | Client sends one request, server streams chunks back |

## Dependencies

- `express` - REST API framework
- `@grpc/grpc-js` - gRPC for Node.js (pure JS implementation)
- `@grpc/proto-loader` - Dynamic .proto file loading
