import sgMail from "@sendgrid/mail";

// Initialize SendGrid with API key
const sendgridApiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.FROM_EMAIL || "noreply@foodbargain.com";

if (sendgridApiKey) {
  sgMail.setApiKey(sendgridApiKey);
} else {
  console.warn("SENDGRID_API_KEY not configured. Email notifications will be disabled.");
}

interface DealExpirationEmailData {
  userEmail: string;
  userName: string;
  dealTitle: string;
  dealDescription: string;
  restaurantName: string;
  expirationDate: string;
  dealId: number;
}

interface NewDealEmailData {
  userEmail: string;
  userName: string;
  dealTitle: string;
  dealDescription: string;
  restaurantName: string;
  startDate: string;
  endDate: string;
  dealId: number;
}

/**
 * Send a deal expiration notification email
 */
export async function sendDealExpirationEmail(data: DealExpirationEmailData): Promise<boolean> {
  if (!sendgridApiKey) {
    console.warn("SendGrid not configured. Skipping email for deal:", data.dealTitle);
    return false;
  }

  try {
    const msg = {
      to: data.userEmail,
      from: fromEmail,
      subject: `⏰ Deal Expiring Soon: ${data.dealTitle}`,
      text: `
Hi ${data.userName},

Your favorite deal is expiring soon!

Deal: ${data.dealTitle}
Restaurant: ${data.restaurantName}
Expires: ${data.expirationDate}

${data.dealDescription}

Don't miss out! Visit the app to view this deal before it expires.

Best regards,
The FoodBargain Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e0e0e0;
      border-top: none;
    }
    .deal-card {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .deal-title {
      font-size: 20px;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 10px;
    }
    .deal-detail {
      margin: 8px 0;
      color: #555;
    }
    .detail-label {
      font-weight: 600;
      color: #333;
    }
    .expiration-warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      color: #856404;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
      text-align: center;
      font-weight: 600;
    }
    .cta-button {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: 600;
    }
    .footer {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 0 0 10px 10px;
      text-align: center;
      color: #777;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">⏰ Deal Expiring Soon!</h1>
  </div>

  <div class="content">
    <p>Hi <strong>${data.userName}</strong>,</p>

    <p>One of your favorite deals is expiring soon! Don't miss out on this great offer.</p>

    <div class="deal-card">
      <div class="deal-title">${data.dealTitle}</div>
      <div class="deal-detail">
        <span class="detail-label">Restaurant:</span> ${data.restaurantName}
      </div>
      <div class="deal-detail">
        <span class="detail-label">Description:</span> ${data.dealDescription || "Limited time offer"}
      </div>
    </div>

    <div class="expiration-warning">
      🕒 Expires on ${data.expirationDate} - Act fast!
    </div>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || "http://localhost:8080"}/deals/${data.dealId}" class="cta-button">
        View Deal Now
      </a>
    </div>

    <p style="margin-top: 30px; color: #777; font-size: 14px;">
      You received this email because you have favorited this deal. You can manage your notification preferences in the app.
    </p>
  </div>

  <div class="footer">
    <p style="margin: 5px 0;">Best regards,<br><strong>The FoodBargain Team</strong></p>
    <p style="margin: 5px 0; font-size: 12px;">© ${new Date().getFullYear()} FoodBargain. All rights reserved.</p>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Email sent to ${data.userEmail} for deal: ${data.dealTitle}`);
    return true;
  } catch (error) {
    console.error("Failed to send email:", error);
    if (error instanceof Error && "response" in error) {
      const sgError = error as { response?: { body: unknown } };
      console.error("SendGrid error details:", sgError.response?.body);
    }
    return false;
  }
}

/**
 * Send a new deal notification email
 */
export async function sendNewDealEmail(data: NewDealEmailData): Promise<boolean> {
  if (!sendgridApiKey) {
    console.warn("SendGrid not configured. Skipping email for deal:", data.dealTitle);
    return false;
  }

  try {
    const msg = {
      to: data.userEmail,
      from: fromEmail,
      subject: `🎉 New Deal at ${data.restaurantName}: ${data.dealTitle}`,
      text: `
Hi ${data.userName},

Great news! One of your favorite restaurants has a new deal!

Deal: ${data.dealTitle}
Restaurant: ${data.restaurantName}
Available: ${data.startDate} to ${data.endDate}

${data.dealDescription}

Check it out now and save big!

Best regards,
The FoodBargain Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 30px;
      border-radius: 10px 10px 0 0;
      text-align: center;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e0e0e0;
      border-top: none;
    }
    .deal-card {
      background: #f0fdf4;
      border-left: 4px solid #10b981;
      padding: 20px;
      margin: 20px 0;
      border-radius: 5px;
    }
    .deal-title {
      font-size: 20px;
      font-weight: bold;
      color: #059669;
      margin-bottom: 10px;
    }
    .deal-detail {
      margin: 8px 0;
      color: #555;
    }
    .detail-label {
      font-weight: 600;
      color: #333;
    }
    .availability-info {
      background: #dbeafe;
      border: 1px solid #3b82f6;
      color: #1e40af;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
      text-align: center;
      font-weight: 600;
    }
    .cta-button {
      display: inline-block;
      background: #10b981;
      color: white;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 5px;
      margin: 20px 0;
      font-weight: 600;
    }
    .footer {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 0 0 10px 10px;
      text-align: center;
      color: #777;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin: 0;">🎉 New Deal Available!</h1>
  </div>

  <div class="content">
    <p>Hi <strong>${data.userName}</strong>,</p>

    <p>Great news! <strong>${data.restaurantName}</strong>, one of your favorite restaurants, just added a new deal!</p>

    <div class="deal-card">
      <div class="deal-title">${data.dealTitle}</div>
      <div class="deal-detail">
        <span class="detail-label">Restaurant:</span> ${data.restaurantName}
      </div>
      <div class="deal-detail">
        <span class="detail-label">Description:</span> ${data.dealDescription || "Amazing deal - check it out!"}
      </div>
    </div>

    <div class="availability-info">
      📅 Available from ${data.startDate} to ${data.endDate}
    </div>

    <div style="text-align: center;">
      <a href="${process.env.FRONTEND_URL || "http://localhost:8080"}/deals/${data.dealId}" class="cta-button">
        View Deal Now
      </a>
    </div>

    <p style="margin-top: 30px; color: #777; font-size: 14px;">
      You received this email because you bookmarked ${data.restaurantName} and opted in for new deal notifications. You can manage your notification preferences in the app.
    </p>
  </div>

  <div class="footer">
    <p style="margin: 5px 0;">Best regards,<br><strong>The FoodBargain Team</strong></p>
    <p style="margin: 5px 0; font-size: 12px;">© ${new Date().getFullYear()} FoodBargain. All rights reserved.</p>
  </div>
</body>
</html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ New deal email sent to ${data.userEmail} for: ${data.dealTitle}`);
    return true;
  } catch (error) {
    console.error("Failed to send new deal email:", error);
    if (error instanceof Error && "response" in error) {
      const sgError = error as { response?: { body: unknown } };
      console.error("SendGrid error details:", sgError.response?.body);
    }
    return false;
  }
}

/**
 * Send a test email to verify SendGrid configuration
 */
export async function sendTestEmail(toEmail: string): Promise<boolean> {
  if (!sendgridApiKey) {
    console.error("SendGrid not configured");
    return false;
  }

  try {
    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: "FoodBargain - Email Configuration Test",
      text: "This is a test email from FoodBargain App. If you received this, your email configuration is working correctly!",
      html: "<strong>This is a test email from FoodBargain App.</strong><p>If you received this, your email configuration is working correctly!</p>",
    };

    await sgMail.send(msg);
    console.log(`✅ Test email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error("Failed to send test email:", error);
    return false;
  }
}
