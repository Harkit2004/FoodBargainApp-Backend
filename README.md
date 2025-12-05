# FoodBargain App Backend

A comprehensive Node.js backend API for the FoodBargain application, featuring restaurant partnerships, deal management, user authentication via Clerk, and rating systems. Built with TypeScript, Express.js, and PostgreSQL for scalable, secure food deal management.

## Features

### Authentication & Authorization
- **Clerk Integration**: Secure user authentication and session management.
- **Role-based Access**: User and Partner role separation with ownership verification.
- **JWT Token Verification**: Secure API endpoint protection with comprehensive middleware.
- **Auto User Sync**: Automatic user creation and updates from Clerk webhooks.

### User Management
- **Profile Management**: Complete user profile CRUD with preferences.
- **Cuisine Preferences**: Dynamic cuisine and dietary preference tracking.
- **Favorites System**: Restaurant and deal bookmarking with real-time updates.
- **Notifications**: Comprehensive notification preferences and delivery.
- **Location Services**: Geographic-based restaurant and deal discovery.

### Partner Management
- **Restaurant Onboarding**: Partner registration and restaurant management.
- **Menu Builder**: Hierarchical menu sections and items with pricing precision.
- **Deal Lifecycle**: Complete deal management (draft to active to expired to archived).
- **Analytics Dashboard**: Restaurant metrics, deal performance, and customer insights.
- **Ownership Verification**: Secure partner-restaurant relationship management.

### Deal System
- **Advanced Discovery**: Comprehensive deal browsing with smart filtering.
- **Location-based Search**: Geographic restaurant and deal discovery.
- **Favorites & Bookmarks**: Personal deal collections with real-time sync.
- **Date-Range Validation**: Smart deal activation based on date ranges.
- **Status Management**: Real-time deal status updates and notifications.

### Rating & Review System
- **Multi-Target Ratings**: 5-star rating system for restaurants, menu items, and deals.
- **Review Tags**: Tag-based review system allowing users to add descriptive tags (e.g., "Great Value", "Tasty") to their reviews.
- **Tag Filtering**: API support for filtering reviews based on selected tags.
- **Review Comments**: Rich comment functionality with moderation support.
- **Aggregate Calculations**: Real-time rating aggregations and statistics.
- **Analytics Integration**: User rating history and trend analysis.

### Content Moderation & Admin
- **Report System**: Users can report inappropriate comments or deals.
- **Dispute Resolution**: System for handling disputes between parties.
- **Admin Controls**: Administrative capabilities to manage users, tags, and content.
- **Tag Management**: Admin ability to create global tags and delete inappropriate ones.

## Technology Stack

- **Runtime**: Node.js 18+ with TypeScript 5.0+
- **Framework**: Express.js with comprehensive middleware
- **Database**: PostgreSQL with Drizzle ORM for type-safe queries
- **Authentication**: Clerk for modern user management
- **Type Safety**: TypeScript with strict mode and comprehensive type coverage
- **Code Quality**: ESLint + Prettier with custom configurations
- **Development**: Hot reloading with ts-node-dev
- **Monitoring**: Structured logging and error tracking
- **Testing**: Jest with comprehensive test coverage

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Clerk account and API keys

## Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd FoodBargainApp-Backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Configuration**

   ```bash
   cp .env.example .env
   ```

   Update `.env` with your configuration:

   ```env
   # Database Configuration
   DATABASE_URL="postgresql://username:password@localhost:5432/foodbargain"
   DB_HOST="localhost"
   DB_PORT=5432
   DB_NAME="foodbargain"
   DB_USER="username"
   DB_PASSWORD="password"

   # Clerk Authentication
   CLERK_SECRET_KEY="sk_test_your_clerk_secret_key_here"
   CLERK_PUBLISHABLE_KEY="pk_test_your_clerk_publishable_key_here"
   CLERK_WEBHOOK_SECRET="whsec_your_webhook_secret_here"

   # Server Configuration
   PORT=8000
   NODE_ENV="development"
   ALLOWED_ORIGINS="http://localhost:8080,http://localhost:3000"

   # API Configuration
   API_PREFIX="/api"
   ```

4. **Database Setup**

   ```bash
   # Generate migrations
   npm run db:generate

   # Apply migrations
   npm run db:migrate
   ```

5. **Start the Server**

   ```bash
   # Development mode
   npm run dev

   # Production build
   npm run build
   npm start
   ```

## API Documentation

The API is documented using Swagger/OpenAPI. Once the server is running, you can access the documentation at:

`http://localhost:8000/api/docs`

## Project Structure

```
src/
├── config/         # Configuration files
├── controllers/    # Request handlers
├── db/             # Database schema and connection
├── jobs/           # Background jobs (cron)
├── middleware/     # Express middleware (auth, validation)
├── routes/         # API route definitions
├── services/       # Business logic
├── types/          # TypeScript type definitions
└── utils/          # Helper functions
```
