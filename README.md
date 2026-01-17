# Trippo Backend API

This is the backend API server for Trippo - Stock & Profit Management Platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env.example` to `.env`
   - Update `.env` with your MongoDB connection string and other configuration

3. Start the development server:
```bash
npm run dev
```

4. Start the production server:
```bash
npm start
```

## MongoDB Connection

The backend is configured to connect to MongoDB using the connection string provided in your `.env` file. The connection is established automatically when the server starts.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/update` - Update user information
- `PUT /api/auth/change-pin` - Change user PIN

### Products
- `GET /api/products` - Get all products (user-specific)
- `GET /api/products/:id` - Get a single product
- `POST /api/products` - Create a new product
- `PUT /api/products/:id` - Update a product
- `DELETE /api/products/:id` - Delete a product

### Sales
- `GET /api/sales` - Get all sales (user-specific)
- `GET /api/sales/:id` - Get a single sale
- `POST /api/sales` - Create a new sale
- `POST /api/sales/bulk` - Create multiple sales
- `PUT /api/sales/:id` - Update a sale
- `DELETE /api/sales/:id` - Delete a sale
- `DELETE /api/sales/all` - Delete all sales (user-specific)

### Admin
- `GET /api/admin/stats` - Get system statistics
- `GET /api/admin/users` - Get all users
- `GET /api/admin/activity` - Get user activity
- `GET /api/admin/usage` - Get user usage statistics
- `GET /api/admin/health` - Get system health
- `GET /api/admin/api-stats` - Get API statistics

## Project Structure

```
backend/
├── src/
│   ├── controllers/    # Request handlers
│   ├── models/         # Data models
│   ├── routes/         # API routes
│   ├── middleware/     # Custom middleware
│   ├── config/         # Configuration files
│   ├── utils/          # Utility functions
│   └── index.js        # Entry point
├── package.json
└── README.md
```

## User Data Isolation

All API endpoints automatically filter data by the authenticated user's ID, ensuring complete data isolation between users. Each user only has access to their own products and sales.

## Admin Access

Admin access is available with:
- Email: `admin`
- PIN: `2026`

## Environment Variables

Required environment variables:
- `MONGODB_URI` - MongoDB connection string
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
