const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Session management
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Data files
const productsData = JSON.parse(fs.readFileSync('./data/products.json', 'utf-8'));
let usersData = JSON.parse(fs.readFileSync('./data/users.json', 'utf-8'));

// Helper functions
function saveUsersData() {
    fs.writeFileSync('./data/users.json', JSON.stringify(usersData, null, 2));
}

function generateOrderId() {
    return 'ORD' + Math.floor(Math.random() * 1000000);
}

function generateTrackingId() {
    return 'TRK' + Math.floor(Math.random() * 1000000);
}

// Routes
app.get('/', (req, res) => {
    const featuredProducts = productsData.slice(0, 6);
    res.render('index', { 
        user: req.session.user,
        featuredProducts 
    });
});

app.get('/products', (req, res) => {
    const category = req.query.category || 'all';
    let filteredProducts = productsData;
    
    if (category !== 'all') {
        filteredProducts = productsData.filter(product => product.category === category);
    }
    
    res.render('products', { 
        user: req.session.user,
        products: filteredProducts,
        categories: [...new Set(productsData.map(p => p.category))]
    });
});

app.get('/product/:id', (req, res) => {
    const product = productsData.find(p => p.id === req.params.id);
    if (!product) return res.status(404).send('Product not found');
    
    res.render('product-detail', { 
        user: req.session.user,
        product 
    });
});

app.get('/cart', (req, res) => {
    if (!req.session.cart) req.session.cart = [];
    
    const cartItems = req.session.cart.map(item => {
        const product = productsData.find(p => p.id === item.productId);
        return { ...item, product };
    }).filter(item => item.product); // Filter out items if product not found
    
    const subtotal = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    
    res.render('cart', { 
        user: req.session.user,
        cartItems,
        subtotal 
    });
});

app.post('/add-to-cart', (req, res) => {
    if (!req.session.cart) req.session.cart = [];
    
    const { productId, quantity } = req.body;
    const existingItem = req.session.cart.find(item => item.productId === productId);
    
    if (existingItem) {
        existingItem.quantity += parseInt(quantity);
    } else {
        req.session.cart.push({ productId, quantity: parseInt(quantity) });
    }
    
    res.redirect('/cart');
});

app.post('/update-cart', (req, res) => {
    const { updates } = req.body;
    
    if (Array.isArray(updates)) {
        updates.forEach(update => {
            const item = req.session.cart.find(item => item.productId === update.productId);
            if (item) {
                item.quantity = parseInt(update.quantity);
                if (item.quantity <= 0) {
                    req.session.cart = req.session.cart.filter(i => i.productId !== update.productId);
                }
            }
        });
    }
    
    res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/cart');
    
    const cartItems = req.session.cart.map(item => {
        const product = productsData.find(p => p.id === item.productId);
        return { ...item, product };
    }).filter(item => item.product);
    
    const subtotal = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const deliveryFee = 5.00; // Example fixed delivery fee
    const total = subtotal + deliveryFee;
    
    res.render('checkout', { 
        user: req.session.user,
        cartItems,
        subtotal,
        deliveryFee,
        total 
    });
});

app.post('/place-order', (req, res) => {
    if (!req.session.user) return res.status(401).send('Unauthorized');
    if (!req.session.cart || req.session.cart.length === 0) return res.status(400).send('Cart is empty');
    
    const { paymentMethod, deliveryAddress, deliveryTime } = req.body;
    
    // Create order
    const orderId = generateOrderId();
    const trackingId = generateTrackingId();
    const orderDate = new Date().toISOString();
    
    const cartItems = req.session.cart.map(item => {
        const product = productsData.find(p => p.id === item.productId);
        return { ...item, product };
    }).filter(item => item.product);
    
    const subtotal = cartItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
    const deliveryFee = 5.00;
    const total = subtotal + deliveryFee;
    
    const order = {
        orderId,
        trackingId,
        userId: req.session.user.id,
        items: cartItems,
        subtotal,
        deliveryFee,
        total,
        paymentMethod,
        deliveryAddress,
        deliveryTime,
        orderDate,
        status: 'processing',
        statusHistory: [
            { status: 'processing', timestamp: new Date().toISOString() }
        ]
    };
    
    // Add order to user's orders
    const user = usersData.find(u => u.id === req.session.user.id);
    if (!user.orders) user.orders = [];
    user.orders.push(order);
    saveUsersData();
    
    // Clear cart
    req.session.cart = [];
    
    res.redirect(`/order-confirmation/${orderId}`);
});

app.get('/order-confirmation/:orderId', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const user = usersData.find(u => u.id === req.session.user.id);
    const order = user.orders.find(o => o.orderId === req.params.orderId);
    
    if (!order) return res.status(404).send('Order not found');
    
    res.render('order-confirmation', { 
        user: req.session.user,
        order 
    });
});

app.get('/track/:trackingId', (req, res) => {
    // Find order by trackingId across all users
    let order = null;
    for (const user of usersData) {
        if (user.orders) {
            const foundOrder = user.orders.find(o => o.trackingId === req.params.trackingId);
            if (foundOrder) {
                order = foundOrder;
                break;
            }
        }
    }
    
    if (!order) return res.status(404).send('Order not found');
    
    res.render('track', { 
        user: req.session.user,
        order 
    });
});

app.get('/account', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const user = usersData.find(u => u.id === req.session.user.id);
    res.render('account', { 
        user: req.session.user,
        orders: user.orders || [] 
    });
});

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/account');
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = usersData.find(u => u.email === email);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.render('login', { error: 'Invalid email or password' });
    }
    
    req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email
    };
    
    res.redirect('/account');
});

app.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/account');
    res.render('register', { error: null });
});

app.post('/register', (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
        return res.render('register', { error: 'Passwords do not match' });
    }
    
    if (usersData.some(u => u.email === email)) {
        return res.render('register', { error: 'Email already registered' });
    }
    
    const newUser = {
        id: 'user' + Math.floor(Math.random() * 1000000),
        name,
        email,
        password: bcrypt.hashSync(password, 10),
        orders: []
    };
    
    usersData.push(newUser);
    saveUsersData();
    
    req.session.user = {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email
    };
    
    res.redirect('/account');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});