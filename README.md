# STOP

A full-stack application for managing clients, groups, attendance, and related administrative tasks.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm
- PostgreSQL database
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd STOP
```

2. Install dependencies for both backend and frontend:
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Set up environment variables:
Create or configure the `.env` file in the `backend` directory with the following variables:
```
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/stop_db
SSL_PFX_PASSWORD=your_ssl_password
```

4. Set up the database:
Run migrations to set up the PostgreSQL database schema. Ensure your database is running and the `DATABASE_URL` is configured correctly.

## Running the Application

### Development Mode

#### Start the Backend Server
```bash
cd backend
npm start
# or
node server.js
```
The backend server will start on `https://localhost:5000`

#### Start the Frontend Development Server
In a new terminal:
```bash
cd frontend
npm run dev
```
The frontend will be available at `http://localhost:5173` (or the URL shown in your terminal)

### Production Build

#### Build the Frontend
```bash
cd frontend
npm run build
```
This generates an optimized production build in the `dist` folder.

#### Run Backend in Production
```bash
cd backend
npm start
```

## Available Scripts

### Backend
- `npm start` - Start the server (defined in package.json if available, otherwise use `node server.js`)

### Frontend
- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production
- `npm run lint` - Run ESLint to check code quality
- `npm run preview` - Preview the production build locally

## Project Structure

```
STOP/
├── backend/           # Express.js backend server
│   ├── server.js      # Main server file
│   ├── passwords.js   # Password hashing utilities
│   ├── migrations/    # Database migrations
│   ├── certs/         # SSL certificates
│   └── package.json
├── frontend/          # React frontend with Vite
│   ├── src/           # React components and utilities
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

## API Endpoints

The backend provides REST API endpoints for:
- Authentication (`/api/auth/`)
- Client management (`/api/clients/`)
- Groups (`/api/groups/`)
- Attendance tracking (`/api/attendance/`)
- Financial transactions (`/api/financials/`)
- Call-in logs (`/api/callin/`)
- Polygraph scheduling (`/api/polygraphs/`)
- Testing (`/api/testing/`)
- Reports (`/api/reports/`)
- Admin functions (`/api/admin/`)

## Database

The application uses PostgreSQL. Ensure the database is created and migrations are run before starting the application.

## Troubleshooting

- **Database Connection Error**: Verify the `DATABASE_URL` in `.env` is correct and PostgreSQL is running
- **Port Already in Use**: Change the `PORT` variable in `.env` or stop other services using that port
- **SSL Certificate Error**: Ensure the certificate file exists at `backend/certs/stop-server.pfx` and the `SSL_PFX_PASSWORD` is correct