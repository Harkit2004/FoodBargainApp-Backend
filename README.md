# 🍽️ FoodBargain App Backend

A comprehensive Node.js backend API for the FoodBargain application, featuring restaurant partnerships, deal management, user authentication via Clerk, and rating systems. Built with TypeScript, Express.js, and PostgreSQL for scalable, secure food deal management.

## 🚀 Features

### Authentication & Authorization
- **🔐 Clerk Integration**: Secure user authentication and session management
- **👥 Role-based Access**: User and Partner role separation with ownership verification
- **🎫 JWT Token Verification**: Secure API endpoint protection with comprehensive middleware
- **🔄 Auto User Sync**: Automatic user creation and updates from Clerk webhooks

### User Management
- **👤 Profile Management**: Complete user profile CRUD with preferences
- **🍽️ Cuisine Preferences**: Dynamic cuisine and dietary preference tracking
- **❤️ Favorites System**: Restaurant and deal bookmarking with real-time updates
- **🔔 Notifications**: Comprehensive notification preferences and delivery
- **📍 Location Services**: Geographic-based restaurant and deal discovery

### Partner Management
- **🏪 Restaurant Onboarding**: Partner registration and restaurant management
- **📋 Menu Builder**: Hierarchical menu sections and items with pricing precision
- **🎯 Deal Lifecycle**: Complete deal management (draft → active → expired → archived)
- **📊 Analytics Dashboard**: Restaurant metrics, deal performance, and customer insights
- **✅ Ownership Verification**: Secure partner-restaurant relationship management

### Deal System
- **🔍 Advanced Discovery**: Comprehensive deal browsing with smart filtering
- **📍 Location-based Search**: Geographic restaurant and deal discovery
- **⭐ Favorites & Bookmarks**: Personal deal collections with real-time sync
- **📅 Date-Range Validation**: Smart deal activation based on date ranges
- **🚀 Status Management**: Real-time deal status updates and notifications

### Rating System
- **⭐ Multi-Target Ratings**: 5-star rating system for restaurants, menu items, and deals
- **💬 Review Comments**: Rich comment functionality with moderation support
- **📊 Aggregate Calculations**: Real-time rating aggregations and statistics
- **📈 Analytics Integration**: User rating history and trend analysis

## 🛠️ Technology Stack

- **⚡ Runtime**: Node.js 18+ with TypeScript 5.0+
- **🚀 Framework**: Express.js with comprehensive middleware
- **🗄️ Database**: PostgreSQL with Drizzle ORM for type-safe queries
- **🔐 Authentication**: Clerk for modern user management
- **📘 Type Safety**: TypeScript with strict mode and comprehensive type coverage
- **✨ Code Quality**: ESLint + Prettier with custom configurations
- **🔧 Development**: Hot reloading with ts-node-dev
- **📊 Monitoring**: Structured logging and error tracking
- **🧪 Testing**: Jest with comprehensive test coverage

## 📋 Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Clerk account and API keys

## ⚙️ Installation

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
   API_VERSION="v1"
   MAX_REQUEST_SIZE="10mb"
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100

   # Logging
   LOG_LEVEL="debug"
   LOG_FORMAT="combined"
   ```

4. **Database Setup**

   ```bash
   # Generate and run database migrations
   npm run db:generate
   npm run db:migrate

   # Optional: Seed with sample data
   npm run db:seed
   ```

5. **Clerk Setup**
   - Create a Clerk application at [clerk.com](https://clerk.com)
   - Copy your Secret Key and Publishable Key to `.env`
   - Configure authentication methods (email/password, social logins, etc.)

## 🚀 Running the Application

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### Linting and Formatting

```bash
npm run lint
npm run lint:fix
npm run prettier
```

## 📡 API Endpoints

### Authentication (`/api/auth`)

- `POST /register` - Create user account via Clerk
- `POST /login` - User session management
- `POST /forgot-password` - Password reset initiation
- `POST /reset-password` - Password reset completion
- `POST /logout` - Session termination

### User Management (`/api/user`)

- `GET /profile` - Get user profile
- `PUT /profile` - Update user profile
- `GET /favorite-cuisines` - Get preferred cuisines
- `POST /favorite-cuisines` - Update cuisine preferences
- `GET /dietary-preferences` - Get dietary preferences
- `POST /dietary-preferences` - Update dietary preferences

### Deal Management (`/api/deals`)

- `GET /` - Browse available deals with advanced filtering
- `GET /:dealId` - **NEW**: Get specific deal details with restaurant info
- `POST /:dealId/favorite` - Bookmark deal for user
- `DELETE /:dealId/favorite` - Remove deal bookmark
- `GET /favorites` - Get user's favorite deals with full details

### Partner Operations (`/api/partner`)

- `POST /register` - Partner registration
- `GET /restaurants` - Get partner's restaurants
- `POST /restaurants` - Add new restaurant
- `PUT /restaurants/:id` - Update restaurant
- `DELETE /restaurants/:id` - Remove restaurant

### Menu Management (`/api/menu`)

- `GET /restaurants/:restaurantId/sections` - Get menu sections
- `POST /restaurants/:restaurantId/sections` - Create menu section
- `PUT /sections/:sectionId` - Update menu section
- `DELETE /sections/:sectionId` - Delete menu section
- `GET /sections/:sectionId/items` - Get menu items
- `POST /sections/:sectionId/items` - Create menu item
- `PUT /items/:itemId` - Update menu item
- `DELETE /items/:itemId` - Delete menu item

### Partner Deal Management (`/api/partner-deals`)

- `POST /` - Create new deal with validation
- `GET /` - Get partner's deals with filtering
- `GET /:dealId` - Get specific deal details
- `PUT /:dealId` - Update deal information
- `PATCH /:dealId/status` - Update deal status (draft/active/expired/archived)
- `PATCH /:dealId/activate` - **NEW**: Smart deal activation based on date ranges
- `DELETE /:dealId` - Delete deal (soft delete for data integrity)

### Restaurant Search (`/api/search`)

- `GET /restaurants` - Search restaurants with location and filters

### Notifications (`/api/notifications`)

- `POST /restaurants/:restaurantId/bookmark` - Bookmark restaurant
- `DELETE /restaurants/:restaurantId/bookmark` - Remove restaurant bookmark
- `GET /bookmarked-restaurants` - Get bookmarked restaurants
- `GET /preferences` - Get notification preferences
- `PUT /preferences` - Update notification preferences

### Rating System (`/api/ratings`)

- `POST /` - Create rating (restaurant/menu item/deal)
- `PUT /:ratingId` - Update rating
- `DELETE /:ratingId` - Delete rating
- `GET /` - Get ratings for target
- `GET /my-ratings` - Get user's ratings

## 🔐 Clerk Integration

### Authentication Flow

1. **Client-Side Authentication**: Users authenticate through Clerk's client-side components
2. **Token Verification**: API verifies JWT tokens from Clerk
3. **User Synchronization**: Automatic user creation/updates in local database
4. **Role Management**: Partner status checked via database relationships

### Middleware Configuration

```typescript
// middleware/auth.ts
import { createClerkClient, verifyToken } from "@clerk/backend";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export const authenticateUser = async (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const payload = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY!,
  });

  // Sync user with local database
  // Set req.user for downstream handlers
};
```

### Frontend Integration Example

```javascript
// Frontend authentication header
const token = await getToken();
const response = await fetch("/api/user/profile", {
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});
```

## 🗄️ Database Schema

The application uses a comprehensive **16-table schema** with full relational integrity:

### Core Tables
- **👤 users** - User profiles with Clerk integration and preferences
- **🤝 partners** - Business partner information and verification status
- **🏪 restaurants** - Restaurant details, locations, and operational data
- **📋 menuSections** - Hierarchical menu organization with ordering
- **🍽️ menuItems** - Individual menu items with precise pricing (cents-based)
- **🎯 deals** - Promotional offers with date ranges and targeting rules
- **⭐ ratings** - Multi-target rating system (restaurants/items/deals)

### Reference Tables
- **🍜 cuisines** - Cuisine categories with localization support
- **🥗 dietaryPreferences** - Dietary restrictions and preferences
- **📍 locations** - Geographic data for restaurant discovery

### Junction Tables (Many-to-Many)
- **userCuisinePreferences** - User cuisine preference mapping
- **userDietaryPreferences** - User dietary restriction mapping
- **userFavoriteDeals** - User deal bookmarking system
- **userFavoriteRestaurants** - Restaurant bookmarking system
- **restaurantCuisines** - Restaurant cuisine type mapping
- **dealTargetCuisines** - Deal targeting by cuisine preferences

### Key Schema Features
- **💰 Precision Pricing**: All monetary values stored as integers (cents) to avoid floating-point precision issues
- **📅 Timezone Safety**: UTC timestamps with timezone-aware date handling
- **🔗 Referential Integrity**: Comprehensive foreign key relationships with cascade rules
- **📊 Performance Optimization**: Strategic indexing on frequently queried columns
- **🔄 Migration Support**: Drizzle ORM migrations for schema evolution

## 🔒 Security Features

- **🎫 JWT Token Verification**: All protected endpoints verify Clerk tokens with comprehensive middleware
- **👥 Role-based Authorization**: Partner-only endpoints enforce ownership verification
- **🛡️ Input Validation**: Comprehensive request validation with sanitization
- **🌐 CORS Configuration**: Configurable cross-origin resource sharing with environment-based origins
- **⏱️ Rate Limiting**: Implemented API protection against abuse
- **💉 SQL Injection Prevention**: Parameterized queries via Drizzle ORM with type safety
- **🔐 Data Encryption**: Sensitive data encryption at rest and in transit
- **📝 Audit Logging**: Comprehensive logging of security-sensitive operations
- **🚫 XSS Protection**: Content Security Policy and input sanitization
- **🔄 Session Management**: Secure session handling via Clerk integration

## 🧪 Testing

### Test Suite
```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Test coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Testing Architecture
- **🔧 Unit Tests**: Individual function and utility testing
- **🔗 Integration Tests**: API endpoint testing with test database
- **🎭 Mock Services**: Clerk authentication mocking for testing
- **📊 Coverage Reports**: Comprehensive code coverage analysis
- **⚡ Parallel Execution**: Fast test execution with Jest parallelization

### Test Database
```bash
# Setup test database
npm run test:db:setup

# Reset test data
npm run test:db:reset
```

## 📦 Deployment

### Environment Variables for Production

```env
NODE_ENV="production"
DATABASE_URL="your_production_database_url"
CLERK_SECRET_KEY="your_production_clerk_secret"
ALLOWED_ORIGINS="https://your-frontend-domain.com"
```

### Docker Deployment

```bash
# Build image
docker build -t foodbargain-backend .

# Run container
docker run -p 3000:3000 --env-file .env foodbargain-backend
```

## 📝 API Documentation

For detailed API documentation with request/response examples, see:

- [Postman Collection](./docs/api-collection.json)
- [OpenAPI Specification](./docs/openapi.yaml)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Related Projects

- [FoodBargain Frontend](../FoodBargainApp-Frontend) - React/Next.js frontend application
- [FoodBargain Mobile](../FoodBargainApp-Mobile) - React Native mobile app

## 📞 Support

For support and questions:

- Create an issue in this repository
- Contact the development team
- Check existing documentation and examples

---

**Built with ❤️ for FoodBargain - Connecting people with great food deals!**
