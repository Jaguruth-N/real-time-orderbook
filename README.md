# Real-Time Orderbook Viewer with Order Simulation

## Objective

This Next.js application displays a real-time orderbook viewer with order simulation capabilities. The application allows users to simulate order placement across multiple cryptocurrency exchanges (OKX, Bybit, and Deribit) and visualize where their orders would sit in the orderbook, helping them understand market impact and optimal timing.

---

## How to Run the Project Locally

This guide will walk you through setting up and running the project after cloning it from a Git repository.

#### **Prerequisites**

Before you begin, make sure you have the following installed on your computer:

1.  **Node.js**: This is the JavaScript runtime. You can download it from [nodejs.org](https://nodejs.org/).
2.  **Git**: The version control system. You can download it from [git-scm.com](https://git-scm.com/).
3.  **Visual Studio Code** (Recommended): The code editor. You can download it from [code.visualstudio.com](https://code.visualstudio.com/).

#### **Step 1: Clone the Repository**

First, clone the project repository to your local machine.

1.  Open your terminal (or Command Prompt/PowerShell on Windows).
2.  Navigate to the directory where you want to store the project.
3.  Run the following command (replace the URL with your actual repository URL):

    ```bash
    git clone [https://github.com/your-username/real-time-orderbook.git](https://github.com/your-username/real-time-orderbook.git)
    ```

#### **Step 2: Navigate to Project Directory**

1.  Change into the newly created project directory:

    ```bash
    cd real-time-orderbook
    ```

#### **Step 3: Install Dependencies**

Install all the necessary project dependencies using `npm`.

1.  Run the following command in the project's root directory:

    ```bash
    npm install
    ```

#### **Step 4: Run the Application**

With the dependencies installed, you can start the local development server.

1.  Run the following command:

    ```bash
    npm run dev
    ```

2.  You will see output in the terminal indicating that the server has started, usually with a message like:

    ```
    ✓ Ready in a few seconds
    - Local:    http://localhost:3000
    ```

#### **Step 5: View in Your Browser**

1.  Open your web browser (like Chrome, Firefox, or Edge).
2.  Navigate to the URL provided in the terminal: **http://localhost:3000**.

You should now see the Real-Time Orderbook Viewer application running live.

---

## Features Implemented

- **Multi-Venue Orderbook Display**: Displays real-time orderbooks from OKX, Bybit, and Deribit with 15 levels of bids and asks.
- **Real-Time Data**: Uses WebSocket connections for live, low-latency data updates.
- **Order Simulation Form**: A comprehensive form to simulate Market and Limit orders with controls for side, price, quantity, and timing.
- **Order Placement Visualization**:
    - **Limit Orders**: Highlights the simulated order's position directly in the order book.
    - **Market Orders**: Highlights the levels of the order book that would be consumed by the order.
- **Market Depth Chart**: A visual representation of the cumulative buy and sell orders.
- **Order Book Imbalance Indicator**: A simple bar showing the ratio of buying vs. selling pressure.
- **Slippage & Impact Warning**: The simulation calculates potential slippage and displays a warning for orders that may cause significant market impact.
- **Timing Scenario Comparison**: Allows users to select multiple execution delays and compares the simulation results side-by-side.

## Libraries & Technologies Used

- **Next.js**: The React framework for building the application.
- **React**: The core UI library.
- **Tailwind CSS**: A utility-first CSS framework for styling the user interface.
- **Recharts**: A composable charting library built on React components, used for the Market Depth chart.
- **Lucide React**: A library of simply beautiful open-source icons.

## Assumptions Made

1.  **Public APIs**: The application relies on the public, unauthenticated WebSocket APIs of the three exchanges. No API keys are required.
2.  **Symbol Normalization**: The application assumes a standard input format of `BASE-QUOTE` (e.g., `BTC-USDT`) and internally normalizes it for each exchange's specific requirements (e.g., `BTCUSDT` for Bybit, `BTC-PERPETUAL` for Deribit).
3.  **Data Consistency**: It is assumed that the data structures from the WebSocket feeds remain consistent with the documented formats. The application includes error handling for parsing, but significant API changes could require code updates.
4.  **Deribit Quantity**: For Deribit, the order `amount` is provided in the quote currency (USD). The application correctly converts this to the base currency (e.g., BTC) by dividing the amount by the price for accurate quantity representation.

## API Documentation & Rate Limiting

### API References

- **OKX API**: [https://www.okx.com/docs-v5/](https://www.okx.com/docs-v5/)
- **Bybit API**: [https://bybit-exchange.github.io/docs/v5/intro](https://bybit-exchange.github.io/docs/v5/intro)
- **Deribit API**: [https://docs.deribit.com/](https://docs.deribit.com/)

### Rate Limiting & Connection Management

This application primarily uses WebSocket streams, which have different connection considerations than standard REST APIs.

- **Connection Limits**: Exchanges typically limit the number of active WebSocket connections per IP address. This application uses a single connection that is closed and reopened when the venue is switched, staying well within typical limits.
- **Subscription Limits**: A single connection can usually handle multiple channel subscriptions. This application subscribes to one order book channel and one ticker channel per connection.
- **Heartbeats (Pings)**: WebSocket connections can be terminated by the server if they appear idle. To prevent this, the application sends periodic "ping" or "heartbeat" messages to each exchange server at the required interval, ensuring the connection remains active. This is a critical feature for stability.
