# FoodBargain App Backend

A comprehensive Node.js backend API for the FoodBargain application, featuring restaurant partnerships, deal management, user authentication via Clerk, and rating systems.

## 🚀 Features

### Authentication & Authorization

- **Clerk Integration**: Secure user authentication and session management
- **Role-based Access**: User and Partner role separation
- **JWT Token Verification**: Secure API endpoint protection

### User Management

- User profile management with preferences
- Cuisine and dietary preference tracking
- Restaurant and deal bookmarking system
- Notification preferences management

### Partner Management

- Partner registration and restaurant onboarding
- Menu management (sections and items)
- Deal lifecycle management (draft → active → expired → archived)
- Restaurant ownership verification

### Deal System

- Comprehensive deal browsing and filtering
- Location-based restaurant search
- Deal favorites and bookmarking
- Real-time deal status management

### Rating System

- 5-star rating system for restaurants, menu items, and deals
- Comment functionality with moderation
- Aggregate rating calculations
- User rating history tracking

## 🛠️ Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Clerk
- **Type Safety**: TypeScript with strict mode
- **Code Quality**: ESLint + Prettier

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
   # Database
   DATABASE_URL="postgresql://username:password@localhost:5432/foodbargain"

   # Clerk Authentication
   CLERK_SECRET_KEY="sk_test_your_clerk_secret_key_here"
   CLERK_PUBLISHABLE_KEY="pk_test_your_clerk_publishable_key_here"

   # Server Configuration
   PORT=3000
   NODE_ENV="development"
   ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"
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

- `GET /` - Browse available deals
- `POST /:dealId/favorite` - Bookmark deal
- `DELETE /:dealId/favorite` - Remove deal bookmark
- `GET /favorites` - Get user's favorite deals

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

- `POST /` - Create new deal
- `GET /` - Get partner's deals
- `GET /:dealId` - Get specific deal
- `PUT /:dealId` - Update deal
- `PATCH /:dealId/status` - Update deal status
- `DELETE /:dealId` - Delete deal

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

The application uses a comprehensive 16-table schema including:

- **users** - User profiles and authentication data
- **partners** - Business partner information
- **restaurants** - Restaurant details and locations
- **menuSections** - Menu organization
- **menuItems** - Individual menu items
- **deals** - Promotional offers and discounts
- **ratings** - User rating and review system
- **cuisines** - Cuisine categories
- **dietaryPreferences** - Dietary restriction options
- Plus junction tables for many-to-many relationships

## 🔒 Security Features

- **JWT Token Verification**: All protected endpoints verify Clerk tokens
- **Role-based Authorization**: Partner-only endpoints enforce ownership
- **Input Validation**: Comprehensive request validation
- **CORS Configuration**: Configurable cross-origin resource sharing
- **Rate Limiting**: Planned implementation for API protection
- **SQL Injection Prevention**: Parameterized queries via Drizzle ORM

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Test coverage
npm run test:coverage
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
