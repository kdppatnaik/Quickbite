/* QuickBite production frontend - Supabase backed & complete */
const { createClient } = window.supabase || {};
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.QUICKBITE_CONFIG || {};

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_SUPABASE")) {
    console.warn("QuickBite: configure config.js with your Supabase URL and publishable/anon key.");
}

const db = createClient
    ? createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_ANON_KEY || "placeholder")
    : null;

// ================= GLOBAL STATE =================
let currentUser = null;
let currentProfile = null;
let currentRole = "user";
let activeRoleView = "user";
let pendingItemToAdd = null;
let cart = [];
let menuItems = [];
let customerOrders = [];
let allAdminOrders = [];
let adminOrdersFilter = "all";
let riderOrders = [];
let riderTab = "available";
let partnerRestaurants = [];
let authMode = "login";
let activeCategory = "All";
let isCartSyncing = false;

const ROLE_LABELS = {
    user: "Customer",
    restaurant: "Restaurant Partner",
    rider: "Delivery Fleet",
    admin: "Platform Admin"
};

const STATUS_LABELS = {
    pending: "Order Placed",
    confirmed: "Restaurant Confirmed",
    preparing: "Kitchen Preparing",
    ready_for_pickup: "Ready for Pickup",
    picked_up: "Out for Delivery",
    delivered: "Delivered",
    cancelled: "Cancelled"
};

const CATEGORY_FALLBACK_IMAGES = {
    "Biryani & Meals": "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80",
    "Pizzas": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80",
    "Rolls & Snacks": "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&auto=format&fit=crop&q=80",
    "Desserts": "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&auto=format&fit=crop&q=80",
    "Brews & Shakes": "https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80",
    "Default": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=80"
};

// ================= UTILITIES =================
function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    }[c]));
}

function money(value) {
    return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
        return dateStr;
    }
}

function isStaff() {
    return ["restaurant", "rider", "admin"].includes(currentRole);
}

function handleImageError(imgEl, category) {
    if (!imgEl) return;
    imgEl.onerror = null;
    imgEl.src = CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES["Default"];
}

function handleProductDetailImageError(imgEl) {
    if (!imgEl) return;
    imgEl.onerror = null;
    const cat = document.getElementById("modalProductCat")?.textContent || "Default";
    imgEl.src = CATEGORY_FALLBACK_IMAGES[cat] || CATEGORY_FALLBACK_IMAGES["Default"];
}

// Modern non-blocking Toast System
function showToast(message, type = "info", duration = 3500) {
    const container = document.getElementById("toastContainer");
    if (!container) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    const icon = type === "success" ? "✓" : type === "error" ? "✕" : type === "warning" ? "⚠️" : "ℹ️";
    toast.innerHTML = `<span style="font-size:16px;">${icon}</span><span>${escapeHtml(message)}</span>`;
    
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("toast-hiding");
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function notify(message, type = "success") {
    showToast(message, type);
}

function showAuthMessage(message, type = "error") {
    const el = document.getElementById("authMessage");
    if (!el) return;
    el.textContent = message;
    el.className = `auth-message ${type}`;
}

function handleBackdropClick(event, modalId) {
    if (event.target && event.target.id === modalId) {
        if (modalId === "loginModal") closeLoginModal();
        else if (modalId === "cartModal") toggleCart();
        else if (modalId === "productDetailModal") closeProductDetailModal();
        else if (modalId === "modalAddDish") closeAddDishModal();
        else if (modalId === "modalEditDish") closeEditDishModal();
        else if (modalId === "modalPrintKot") closePrintKotModal();
    }
}

// ================= AUTHENTICATION =================
function openLoginModal(targetItemId = null) {
    if (targetItemId) pendingItemToAdd = targetItemId;
    authMode = "login";
    syncAuthModal();
    const modal = document.getElementById("loginModal");
    if (modal) modal.style.display = "flex";
}

function closeLoginModal() {
    const modal = document.getElementById("loginModal");
    if (modal) modal.style.display = "none";
    showAuthMessage("");
}

function toggleAuthMode() {
    authMode = authMode === "login" ? "signup" : "login";
    syncAuthModal();
}

function syncAuthModal() {
    const signup = authMode === "signup";
    document.getElementById("authModalTitle").textContent = signup ? "Create your QuickBite account" : "Login to QuickBite";
    document.getElementById("authModalSubtitle").textContent = signup
        ? "Sign up instantly as a Customer. Staff access can be granted by administrators."
        : "Use your registered email and password to continue.";
    document.getElementById("authNameGroup").style.display = signup ? "block" : "none";
    document.getElementById("loginUsername").required = signup;
    document.getElementById("loginPassword").autocomplete = signup ? "new-password" : "current-password";
    document.getElementById("authSubmitBtn").textContent = signup ? "Create Account" : "Login";
    document.getElementById("authModeToggle").textContent = signup ? "Already have an account? Log In" : "Don't have an account? Sign Up";
    showAuthMessage("");
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    if (!db) return showAuthMessage("Supabase client not initialized.", "error");

    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const name = document.getElementById("loginUsername").value.trim();
    const button = document.getElementById("authSubmitBtn");
    
    button.disabled = true;
    showAuthMessage("Authenticating, please wait...", "info");

    try {
        if (authMode === "signup") {
            const { data, error } = await db.auth.signUp({
                email,
                password,
                options: { data: { full_name: name || "QuickBite Customer" } }
            });
            if (error) throw error;

            if (!data.session) {
                showAuthMessage("Account created! Check your email to verify your address, then log in.", "success");
                showToast("Account created. Please verify your email to log in.", "info");
                return;
            }
            showToast("Welcome to QuickBite!", "success");
        } else {
            const { error } = await db.auth.signInWithPassword({ email, password });
            if (error) throw error;
            showToast("Welcome back!", "success");
        }

        closeLoginModal();
        await loadSession();

        if (pendingItemToAdd && currentRole === "user") {
            await addToCart(pendingItemToAdd);
            pendingItemToAdd = null;
        }
    } catch (err) {
        showAuthMessage(err.message || "Authentication failed.", "error");
    } finally {
        button.disabled = false;
    }
}

async function logoutUser() {
    if (db) await db.auth.signOut();
    currentUser = null;
    currentProfile = null;
    currentRole = "user";
    activeRoleView = "user";
    cart = [];
    customerOrders = [];
    updateCartCount();
    applyUserSession();
    await loadMenu();
    showToast("You have been logged out.", "info");
}

async function loadSession() {
    if (!db) return;
    try {
        const { data: { session } } = await db.auth.getSession();
        currentUser = session?.user || null;

        if (currentUser) {
            let { data: profile, error } = await db.from("profiles").select("id,full_name,role,phone").eq("id", currentUser.id).maybeSingle();
            
            // If profile does not exist yet (edge case on first signup before trigger), bootstrap it
            if (!profile) {
                const userFullName = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "QuickBite User";
                const insertRes = await db.from("profiles").insert({
                    id: currentUser.id,
                    full_name: userFullName,
                    role: "user"
                }).select().single();
                profile = insertRes.data;
            }

            currentProfile = profile;
            currentRole = profile?.role || "user";
            activeRoleView = currentRole;
            await loadCart();
        } else {
            currentProfile = null;
            currentRole = "user";
            activeRoleView = "user";
            cart = [];
            loadLocalCart();
        }
    } catch (err) {
        console.error("Error loading session:", err);
    }
    applyUserSession();
}

let lastLoadedUserId = null;
let lastLoadedRole = null;

function applyUserSession() {
    const authArea = document.getElementById("authStatusArea");
    const roleBanner = document.getElementById("roleBanner");
    const staffPortalBtn = document.getElementById("staffPortalNavBtn");
    const returnDashboardBtn = document.getElementById("btnReturnToDashboard");
    const roleSwitcherWrap = document.getElementById("roleSwitcherWrapper");
    const roleSwitchSelect = document.getElementById("roleSwitchSelect");

    if (currentUser && currentProfile) {
        if (currentUser.id !== lastLoadedUserId || currentRole !== lastLoadedRole) {
            activeRoleView = currentRole;
            lastLoadedUserId = currentUser.id;
            lastLoadedRole = currentRole;
        }
        const userDisplayName = currentProfile.full_name || currentUser.email?.split("@")[0] || "User";
        const roleLabel = ROLE_LABELS[currentRole] || "Customer";
        
        authArea.innerHTML = `
            <div class="user-pill" title="${escapeHtml(currentUser.email)}">
                <span>👤 <strong>${escapeHtml(userDisplayName)}</strong> (${roleLabel})</span>
                <button onclick="logoutUser()" class="btn-logout-link" title="Sign out">Logout</button>
            </div>
        `;

        if (isStaff()) {
            roleBanner.style.display = "flex";
            document.getElementById("activeRoleName").textContent = `${ROLE_LABELS[currentRole]} Portal`;
            staffPortalBtn.style.display = "inline-flex";
            staffPortalBtn.textContent = currentRole === "restaurant" ? "🏪 Portal" : currentRole === "rider" ? "🛵 Fleet" : "⚡ Admin";
            
            // Show return to dashboard button if user is staff but currently browsing menu or customer orders
            returnDashboardBtn.style.display = (activeRoleView === "user" || activeRoleView === "orders") ? "inline-block" : "none";

            // Allow role switcher for admin or tester
            if (currentRole === "admin") {
                roleSwitcherWrap.style.display = "flex";
                if (roleSwitchSelect) roleSwitchSelect.value = activeRoleView;
            } else {
                roleSwitcherWrap.style.display = "none";
            }
        } else {
            roleBanner.style.display = "none";
            staffPortalBtn.style.display = "none";
            roleSwitcherWrap.style.display = "none";
        }
    } else {
        authArea.innerHTML = `<button class="btn-login" onclick="openLoginModal()">Login / Sign Up</button>`;
        roleBanner.style.display = "none";
        staffPortalBtn.style.display = "none";
        roleSwitcherWrap.style.display = "none";
    }

    switchRoleView(activeRoleView);
}

function switchRoleView(view) {
    activeRoleView = view;

    // Toggle view sections
    document.querySelectorAll(".role-view").forEach(v => v.classList.remove("active"));
    const targetSection = document.getElementById(`${view}Section`) || document.getElementById("userSection");
    if (targetSection) targetSection.classList.add("active");

    // Toggle Navbar buttons active state
    document.getElementById("navMenuBtn")?.classList.toggle("active", view === "user");
    document.getElementById("navOrdersBtn")?.classList.toggle("active", view === "orders");
    document.getElementById("staffPortalNavBtn")?.classList.toggle("active", isStaff() && (view === currentRole || view === "restaurant" || view === "rider" || view === "admin"));

    // Cart and Search are visible in customer shopping view
    const isShoppingView = (view === "user");
    document.getElementById("cartNavBtn").style.display = isShoppingView ? "flex" : "none";
    document.getElementById("navSearchWrapper").style.display = isShoppingView ? "flex" : "none";

    // Update banner return button visibility
    const returnDashboardBtn = document.getElementById("btnReturnToDashboard");
    if (returnDashboardBtn) {
        returnDashboardBtn.style.display = (isStaff() && (view === "user" || view === "orders")) ? "inline-block" : "none";
    }

    // Role switcher sync
    const roleSwitchSelect = document.getElementById("roleSwitchSelect");
    if (roleSwitchSelect) roleSwitchSelect.value = view;

    // Trigger data loading for active view
    if (view === "user") renderFoodMenu(menuItems);
    else if (view === "restaurant") loadRestaurantData();
    else if (view === "rider") loadRiderOrders();
    else if (view === "admin") loadAdminDashboard();
    else if (view === "orders") loadCustomerOrders();
}

function returnToActivePortal() {
    switchRoleView(currentRole);
}

function openStaffPortal() {
    switchRoleView(currentRole);
}

function changeViewRole(newRole) {
    switchRoleView(newRole);
}

function showCustomerOrders() {
    if (!currentUser) {
        openLoginModal();
        return;
    }
    switchRoleView("orders");
    loadCustomerOrders();
}

// ================= FOOD MENU & CATALOG =================
async function loadMenu() {
    if (!db) return;
    try {
        const { data, error } = await db
            .from("menu_items")
            .select("id,restaurant_id,name,category,description,price,image_url,is_available,restaurants(name,is_open)")
            .eq("is_available", true)
            .order("created_at", { ascending: false });

        if (error) throw error;

        menuItems = (data || []).map(x => ({
            ...x,
            restaurant: x.restaurants?.name || "Partner Kitchen",
            restaurant_is_open: x.restaurants?.is_open ?? true,
            desc: x.description,
            image: x.image_url
        }));

        const countBadge = document.getElementById("menuCountBadge");
        if (countBadge) countBadge.textContent = `${menuItems.length} dishes available`;

        filterMenu();
    } catch (err) {
        console.error("Unable to load menu:", err);
        showToast("Unable to load food menu. Check Supabase connection.", "error");
    }
}

function renderFoodMenu(items) {
    const grid = document.getElementById("foodGrid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!items.length) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: white; border-radius: 16px; border: 1px solid var(--border);">
                <span style="font-size: 40px; display: block; margin-bottom: 12px;">🔍</span>
                <h3 style="font-size: 20px; margin-bottom: 6px;">No matching dishes found</h3>
                <p style="color: var(--text-muted); font-size: 14px;">Try searching with a different cuisine, dish name, or reset category filters.</p>
                <button class="btn-primary" onclick="filterCategory('All')" style="margin-top: 15px;">Show All Dishes</button>
            </div>
        `;
        return;
    }

    items.forEach(dish => {
        const card = document.createElement("div");
        card.className = "food-card";
        card.onclick = () => openProductDetailModal(dish.id);

        const safeImg = escapeHtml(dish.image || CATEGORY_FALLBACK_IMAGES[dish.category] || CATEGORY_FALLBACK_IMAGES["Default"]);
        const shortDesc = (dish.desc || "").length > 60 ? dish.desc.substring(0, 60) + "..." : (dish.desc || "");

        card.innerHTML = `
            <div class="card-img-wrap">
                <img src="${safeImg}" alt="${escapeHtml(dish.name)}" loading="lazy" onerror="handleImageError(this, '${escapeHtml(dish.category)}')">
                <span class="restaurant-badge">🏪 ${escapeHtml(dish.restaurant)}</span>
                <span class="card-chip">${escapeHtml(dish.category)}</span>
            </div>
            <div class="card-body">
                <div>
                    <h3 class="food-title">${escapeHtml(dish.name)}</h3>
                    <p class="food-desc">${escapeHtml(shortDesc)}</p>
                </div>
                <div class="card-footer">
                    <span class="food-price">${money(dish.price)}</span>
                    <button class="btn-add" id="btnAdd-${dish.id}" onclick="event.stopPropagation(); handleItemOrderClick('${dish.id}')">Add +</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function filterMenu() {
    const searchInput = document.getElementById("searchInput");
    const query = (searchInput?.value || "").trim().toLowerCase();
    
    // Toggle search clear button
    const clearBtn = document.getElementById("searchClearBtn");
    if (clearBtn) clearBtn.style.display = query ? "flex" : "none";

    let filtered = menuItems;
    if (query) {
        filtered = filtered.filter(i =>
            `${i.name} ${i.restaurant} ${i.category} ${i.desc || ""}`.toLowerCase().includes(query)
        );
        // Automatically sync category chips to 'All' when executing global search
        if (activeCategory !== "All") {
            activeCategory = "All";
            document.querySelectorAll(".cat-chip").forEach(btn => {
                const btnCat = btn.getAttribute("data-category") || btn.textContent.trim();
                btn.classList.toggle("active", btnCat === "All");
            });
        }
    } else if (activeCategory !== "All") {
        filtered = filtered.filter(i => (i.category || "").toLowerCase() === activeCategory.toLowerCase());
    }

    renderFoodMenu(filtered);
}

function clearSearch() {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.value = "";
    filterCategory("All");
}

function filterCategory(cat) {
    activeCategory = cat;
    document.querySelectorAll(".cat-chip").forEach(btn => {
        const btnCat = btn.getAttribute("data-category") || btn.textContent.trim();
        btn.classList.toggle("active", btnCat.toLowerCase() === cat.toLowerCase());
    });
    filterMenu();
}

function openProductDetailModal(id) {
    const dish = menuItems.find(d => String(d.id) === String(id));
    if (!dish) return;

    const imgEl = document.getElementById("modalProductImg");
    imgEl.src = dish.image || CATEGORY_FALLBACK_IMAGES[dish.category] || CATEGORY_FALLBACK_IMAGES["Default"];
    imgEl.onerror = () => handleProductDetailImageError(imgEl);

    document.getElementById("modalProductRes").textContent = `🏪 ${dish.restaurant}`;
    document.getElementById("modalProductCat").textContent = dish.category;
    document.getElementById("modalProductTitle").textContent = dish.name;
    document.getElementById("modalProductDesc").textContent = dish.desc || "Chef's signature preparation with fresh ingredients.";
    document.getElementById("modalProductPrice").textContent = Number(dish.price).toLocaleString("en-IN");

    document.getElementById("modalAddToCartBtn").onclick = async () => {
        await handleItemOrderClick(dish.id);
        closeProductDetailModal();
    };

    document.getElementById("modalBuyNowBtn").onclick = async () => {
        await handleBuyNow(dish.id);
    };

    document.getElementById("productDetailModal").style.display = "flex";
}

function closeProductDetailModal() {
    document.getElementById("productDetailModal").style.display = "none";
}

// ================= CART MANAGEMENT =================
async function handleItemOrderClick(id) {
    if (!currentUser) {
        openLoginModal(id);
        return;
    }

    if (isStaff() && currentRole !== "user") {
        showToast("Logged in as staff. Switch to Customer View to order meals.", "warning");
        return;
    }

    await addToCart(id);
}

async function addToCart(id) {
    const dish = menuItems.find(d => String(d.id) === String(id));
    if (!dish) return;

    // Check if cart already has items from another restaurant
    const firstItem = cart[0];
    const existingRestaurantId = firstItem?.restaurant_id || firstItem?.menu?.restaurant_id;

    if (cart.length && existingRestaurantId && String(existingRestaurantId) !== String(dish.restaurant_id)) {
        const existingName = firstItem?.menu?.restaurant || "another restaurant";
        const ok = confirm(`Your cart has items from "${existingName}". Discard previous items and start a new order from "${dish.restaurant}"?`);
        if (!ok) return;
        await clearCart();
    }

    const existingIndex = cart.findIndex(i => String(i.menu_item_id) === String(dish.id));
    if (existingIndex >= 0) {
        cart[existingIndex].quantity += 1;
    } else {
        cart.push({
            menu_item_id: dish.id,
            restaurant_id: dish.restaurant_id,
            quantity: 1,
            menu: dish
        });
    }

    // Visual button feedback
    const addBtn = document.getElementById(`btnAdd-${dish.id}`);
    if (addBtn) {
        const originalText = addBtn.textContent;
        addBtn.textContent = "Added ✓";
        addBtn.style.background = "#10b981";
        addBtn.style.color = "white";
        setTimeout(() => {
            addBtn.textContent = originalText;
            addBtn.style.background = "";
            addBtn.style.color = "";
        }, 800);
    }

    await persistCart();
    renderCartItems();
    updateCartCount();
    showToast(`Added ${dish.name} to cart!`, "success", 2000);
}

async function loadCart() {
    if (!currentUser || !db) {
        loadLocalCart();
        return;
    }

    try {
        const { data, error } = await db
            .from("cart_items")
            .select("id,menu_item_id,quantity,menu_items(id,restaurant_id,name,category,description,price,image_url,restaurants(name))")
            .eq("user_id", currentUser.id)
            .order("created_at");

        if (error) throw error;

        cart = (data || []).map(x => ({
            id: x.id,
            menu_item_id: x.menu_item_id,
            quantity: x.quantity,
            restaurant_id: x.menu_items?.restaurant_id,
            menu: {
                ...x.menu_items,
                restaurant: x.menu_items?.restaurants?.name || "Restaurant",
                desc: x.menu_items?.description,
                image: x.menu_items?.image_url
            }
        })).filter(x => x.menu && x.menu.name);

        saveLocalCart();
    } catch (err) {
        console.error("Error loading cart:", err);
        loadLocalCart();
    }

    renderCartItems();
    updateCartCount();
}

function saveLocalCart() {
    try {
        localStorage.setItem("qb_cart_cache", JSON.stringify(cart));
    } catch {}
}

function loadLocalCart() {
    try {
        const cached = localStorage.getItem("qb_cart_cache");
        if (cached) cart = JSON.parse(cached);
    } catch {
        cart = [];
    }
    renderCartItems();
    updateCartCount();
}

async function persistCart() {
    saveLocalCart();
    if (!currentUser || !db || isCartSyncing) return;

    isCartSyncing = true;
    try {
        await db.from("cart_items").delete().eq("user_id", currentUser.id);

        if (cart.length > 0) {
            const rows = cart.map(x => ({
                user_id: currentUser.id,
                menu_item_id: x.menu_item_id,
                quantity: x.quantity
            }));
            await db.from("cart_items").insert(rows);
        }
    } catch (err) {
        console.error("Cart sync error:", err);
    } finally {
        isCartSyncing = false;
    }
}

async function clearCart() {
    cart = [];
    saveLocalCart();
    if (currentUser && db) {
        try {
            await db.from("cart_items").delete().eq("user_id", currentUser.id);
        } catch (e) {
            console.error("Error clearing DB cart:", e);
        }
    }
    renderCartItems();
    updateCartCount();
}

function updateCartCount() {
    const totalCount = cart.reduce((n, x) => n + Number(x.quantity || 0), 0);
    const countBadge = document.getElementById("cartCount");
    if (countBadge) countBadge.textContent = totalCount;
}

function toggleCart() {
    const modal = document.getElementById("cartModal");
    if (!modal) return;
    const isShowing = modal.style.display === "flex";
    modal.style.display = isShowing ? "none" : "flex";

    if (!isShowing) {
        renderCartItems();
        // Pre-fill delivery address from localStorage
        const addrField = document.getElementById("deliveryAddress");
        if (addrField && !addrField.value) {
            addrField.value = localStorage.getItem("qb_saved_address") || "";
        }
    }
}

function renderCartItems() {
    const container = document.getElementById("cartItems");
    const totalEl = document.getElementById("totalPrice");
    const restaurantLabel = document.getElementById("cartRestaurantLabel");
    if (!container || !totalEl) return;

    container.innerHTML = "";

    if (!cart.length) {
        container.innerHTML = `
            <div style="text-align:center; padding: 30px 10px; color:#9ca3af;">
                <span style="font-size:36px; display:block; margin-bottom:8px;">🛒</span>
                <p>Your food cart is empty.</p>
                <button class="btn-primary" style="margin-top:10px; padding: 6px 14px; font-size:13px;" onclick="toggleCart()">Browse Dishes</button>
            </div>
        `;
        totalEl.textContent = "0";
        if (restaurantLabel) restaurantLabel.textContent = "";
        return;
    }

    const currentRest = cart[0]?.menu?.restaurant || "Partner Kitchen";
    if (restaurantLabel) restaurantLabel.textContent = `Ordering from: ${currentRest}`;

    let grandTotal = 0;
    cart.forEach((item, index) => {
        const price = Number(item.menu?.price || 0);
        const qty = Number(item.quantity || 1);
        const subtotal = price * qty;
        grandTotal += subtotal;

        const row = document.createElement("div");
        row.className = "cart-item-row";
        row.innerHTML = `
            <div style="flex:1;">
                <strong>${escapeHtml(item.menu?.name || "Food Item")}</strong>
                <div style="font-size:12px; color:#888;">${escapeHtml(item.menu?.restaurant || "")} • ${money(price)} each</div>
                <div class="cart-qty">
                    <button type="button" onclick="changeCartQty(${index}, -1)" aria-label="Decrease quantity">−</button>
                    <span>${qty}</span>
                    <button type="button" onclick="changeCartQty(${index}, 1)" aria-label="Increase quantity">+</button>
                </div>
            </div>
            <div style="text-align:right;">
                <strong>${money(subtotal)}</strong>
                <button type="button" onclick="removeFromCart(${index})" style="background:none; border:none; color:#ef4444; margin-left:8px; cursor:pointer; font-weight:bold; font-size:14px;" title="Remove dish">✕</button>
            </div>
        `;
        container.appendChild(row);
    });

    totalEl.textContent = Number(grandTotal).toLocaleString("en-IN");
}

async function changeCartQty(index, delta) {
    if (!cart[index]) return;
    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    await persistCart();
    renderCartItems();
    updateCartCount();
}

async function removeFromCart(index) {
    if (!cart[index]) return;
    const removedName = cart[index].menu?.name || "Item";
    cart.splice(index, 1);
    await persistCart();
    renderCartItems();
    updateCartCount();
    showToast(`Removed ${removedName} from cart.`, "info", 2000);
}

async function handleBuyNow(id) {
    if (!currentUser) {
        closeProductDetailModal();
        openLoginModal(id);
        return;
    }

    if (isStaff() && currentRole !== "user") {
        showToast("Logged in as staff. Switch to Customer View to buy meals.", "warning");
        return;
    }

    await clearCart();
    await addToCart(id);
    closeProductDetailModal();
    toggleCart();

    const addrField = document.getElementById("deliveryAddress");
    if (addrField) addrField.focus();
}

// ================= ORDER PLACEMENT & CUSTOMER ORDERS =================
async function placeOrder() {
    if (!currentUser) {
        openLoginModal();
        return;
    }

    if (!cart.length) {
        showToast("Please add dishes to your cart before placing an order.", "warning");
        return;
    }

    const addrField = document.getElementById("deliveryAddress");
    const deliveryAddress = addrField?.value.trim();
    if (!deliveryAddress) {
        showToast("Please enter your complete delivery address.", "error");
        if (addrField) addrField.focus();
        return;
    }

    // Save address for user convenience
    localStorage.setItem("qb_saved_address", deliveryAddress);

    const placeBtn = document.getElementById("btnPlaceOrder");
    if (placeBtn) {
        placeBtn.disabled = true;
        placeBtn.textContent = "Placing Order...";
    }

    try {
        const { data, error } = await db.rpc("create_order_from_cart", {
            p_delivery_address: deliveryAddress
        });

        if (error) throw error;

        await clearCart();
        toggleCart();
        showToast(`Order #${data} placed successfully! Tracking your order.`, "success", 4000);

        showCustomerOrders();
    } catch (err) {
        console.error("Order placement failed:", err);
        showToast(err.message || "Failed to place order. Please try again.", "error");
    } finally {
        if (placeBtn) {
            placeBtn.disabled = false;
            placeBtn.textContent = "Place Order";
        }
    }
}

async function loadCustomerOrders() {
    if (!currentUser || !db) return;

    try {
        const { data, error } = await db
            .from("orders")
            .select("id,order_number,total_amount,status,delivery_address,created_at,restaurants(name),order_items(quantity,unit_price,menu_items(name))")
            .eq("customer_id", currentUser.id)
            .order("created_at", { ascending: false });

        if (error) throw error;
        customerOrders = data || [];

        // Update nav badge count for active orders
        const activeCount = customerOrders.filter(o => !["delivered", "cancelled"].includes(o.status)).length;
        const navBadge = document.getElementById("navOrdersBadge");
        if (navBadge) {
            navBadge.textContent = activeCount;
            navBadge.style.display = activeCount > 0 ? "inline-block" : "none";
        }

        renderCustomerOrders();
    } catch (err) {
        console.error("Error loading customer orders:", err);
    }
}

function renderCustomerOrders() {
    const listEl = document.getElementById("customerOrdersList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!customerOrders.length) {
        listEl.innerHTML = `
            <div class="empty-orders-box">
                <div class="empty-icon">🍽️</div>
                <h3>No Orders Yet</h3>
                <p>When you place an order, you can track food preparation and doorstep delivery right here.</p>
                <button class="btn-primary" onclick="switchRoleView('user')">Browse Restaurants & Menu</button>
            </div>
        `;
        return;
    }

    const STEPS = ["pending", "confirmed", "preparing", "ready_for_pickup", "picked_up", "delivered"];
    const STEP_NAMES = ["Order Placed", "Confirmed", "In Kitchen", "Ready", "Out for Delivery", "Delivered"];

    customerOrders.forEach(order => {
        const isCancelled = order.status === "cancelled";
        const currentIndex = STEPS.indexOf(order.status);
        const orderDate = formatDate(order.created_at);
        const restaurantName = order.restaurants?.name || "Partner Restaurant";

        const card = document.createElement("article");
        card.className = "customer-order-card";

        // Build items list
        const itemsHtml = (order.order_items || []).map(i => `
            <li>
                <span>${escapeHtml(i.menu_items?.name || "Delicious Dish")} &times; ${i.quantity}</span>
                <span>${money(Number(i.unit_price) * Number(i.quantity))}</span>
            </li>
        `).join("");

        // Build stepper html
        let stepperHtml = "";
        if (!isCancelled) {
            const stepsHtml = STEPS.map((step, idx) => {
                const isCompleted = currentIndex > idx;
                const isActive = currentIndex === idx;
                const stateClass = isCompleted ? "completed" : isActive ? "active" : "";
                const dotContent = isCompleted ? "✓" : idx + 1;
                return `
                    <div class="stepper-step ${stateClass}">
                        <div class="stepper-dot">${dotContent}</div>
                        <span class="stepper-label">${STEP_NAMES[idx]}</span>
                    </div>
                `;
            }).join("");

            const progressPct = currentIndex >= 0 ? Math.min(100, (currentIndex / (STEPS.length - 1)) * 100) : 0;

            stepperHtml = `
                <div class="order-stepper">
                    <div class="stepper-line"><div class="stepper-line-fill" style="width:${progressPct}%"></div></div>
                    ${stepsHtml}
                </div>
            `;
        }

        const statusClass = isCancelled ? "status-cancelled" : order.status === "delivered" ? "status-done" : order.status === "confirmed" ? "status-confirmed" : order.status === "picked_up" ? "status-transit" : "status-prep";

        card.innerHTML = `
            <div class="order-card-header">
                <div class="order-title-group">
                    <h3>Order #${escapeHtml(order.order_number)}</h3>
                    <div class="order-meta-info">🏪 <strong>${escapeHtml(restaurantName)}</strong> &bull; ${orderDate}</div>
                </div>
                <div>
                    <span class="delivery-status ${statusClass}">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>
                </div>
            </div>

            ${stepperHtml}

            <div class="order-card-body">
                <div class="order-items-summary">
                    <strong style="font-size:13px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Ordered Items</strong>
                    <ul>${itemsHtml || "<li>No items recorded</li>"}</ul>
                </div>
                <div class="order-delivery-address-box">
                    <strong style="display:block; margin-bottom:4px; font-size:12px;">DELIVERY ADDRESS</strong>
                    📍 ${escapeHtml(order.delivery_address || "Address not specified")}
                </div>
            </div>

            <div class="order-card-footer">
                <div>
                    <span style="font-size:13px; color:var(--text-muted);">Total Amount Paid:</span>
                    <strong class="order-total-amount">${money(order.total_amount)}</strong>
                </div>
                <div>
                    ${order.status === "pending" ? `<button class="btn-cancel-order" onclick="cancelCustomerOrder('${order.id}')">Cancel Order</button>` : ""}
                </div>
            </div>
        `;

        listEl.appendChild(card);
    });
}

async function cancelCustomerOrder(orderId) {
    const ok = confirm("Are you sure you want to cancel this order?");
    if (!ok) return;

    try {
        // Try safe RPC first
        const { error: rpcErr } = await db.rpc("cancel_customer_order", { p_order_id: orderId });
        if (rpcErr) {
            // Fallback direct update under customer RLS policy
            const { error: updateErr } = await db.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("status", "pending");
            if (updateErr) throw updateErr;
        }

        showToast("Order cancelled successfully.", "info");
        await loadCustomerOrders();
    } catch (err) {
        console.error("Cancel order error:", err);
        showToast(err.message || "Could not cancel order.", "error");
    }
}

// ================= ENTERPRISE RESTAURANT PARTNER PORTAL =================
let restaurantActiveTab = "orders";
let kitchenFilterStatus = "all";
let activeRestaurantDishes = [];
let activeRestaurantOrders = [];
let orderChimeEnabled = true;
let currentRestaurantRecord = null;
let knownPendingOrderIds = new Set();
let availableRestaurantsForStaff = [];

function getActiveRestaurantId() {
    return currentRestaurantRecord?.id || currentProfile?.restaurant_id || localStorage.getItem("quickbite_active_restaurant_id") || null;
}

// Pleasant Web Audio kitchen chime for incoming orders
function playKitchenChime() {
    if (!orderChimeEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = "sine";
        osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5

        gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime + 0.15);
        osc1.stop(ctx.currentTime + 0.4);
        osc2.stop(ctx.currentTime + 0.8);
    } catch (e) {
        console.warn("Audio chime unavailable:", e);
    }
}

function toggleOrderChime() {
    orderChimeEnabled = !orderChimeEnabled;
    const btn = document.getElementById("restAudioChimeBtn");
    if (btn) {
        btn.textContent = orderChimeEnabled ? "🔔 Chime: On" : "🔕 Chime: Off";
        btn.classList.toggle("is-muted", !orderChimeEnabled);
    }
    showToast(`Kitchen audio chime ${orderChimeEnabled ? "enabled" : "muted"}.`, "info");
}

function switchRestaurantTab(tabName) {
    restaurantActiveTab = tabName;
    document.querySelectorAll(".rest-nav-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".rest-tab-pane").forEach(p => p.classList.remove("active"));

    if (tabName === "orders") {
        document.getElementById("restTabBtnOrders")?.classList.add("active");
        document.getElementById("restPaneOrders")?.classList.add("active");
        loadRestaurantOrders();
    } else if (tabName === "menu") {
        document.getElementById("restTabBtnMenu")?.classList.add("active");
        document.getElementById("restPaneMenu")?.classList.add("active");
        if (!activeRestaurantDishes.length) {
            loadRestaurantMenuDishes();
        } else {
            filterRestaurantMenu();
        }
    } else if (tabName === "analytics") {
        document.getElementById("restTabBtnAnalytics")?.classList.add("active");
        document.getElementById("restPaneAnalytics")?.classList.add("active");
        loadRestaurantAnalytics();
    } else if (tabName === "settings") {
        document.getElementById("restTabBtnSettings")?.classList.add("active");
        document.getElementById("restPaneSettings")?.classList.add("active");
        if (currentRestaurantRecord) {
            const settingName = document.getElementById("settingRestName");
            const settingDesc = document.getElementById("settingRestDesc");
            const settingImg = document.getElementById("settingRestImg");
            const settingPrep = document.getElementById("settingRestPrepTime");
            const savedPrepTime = localStorage.getItem(`quickbite_rest_preptime_${currentRestaurantRecord.id}`) || "20";
            if (settingName) settingName.value = currentRestaurantRecord.name || "";
            if (settingDesc) settingDesc.value = currentRestaurantRecord.description || "";
            if (settingPrep) settingPrep.value = savedPrepTime;
            if (settingImg) {
                settingImg.value = currentRestaurantRecord.image_url || "";
                previewSettingsCover(currentRestaurantRecord.image_url || "");
            }
        }
    }
}

async function switchManagingRestaurant(restaurantId) {
    if (!restaurantId) return;
    localStorage.setItem("quickbite_active_restaurant_id", restaurantId);
    await loadRestaurantData(restaurantId);
    showToast(`Switched active store to "${currentRestaurantRecord?.name || "selected store"}".`, "info");
}

async function loadRestaurantData(requestedRestaurantId = null) {
    if (currentRole !== "restaurant" && currentRole !== "admin") return;
    if (!db || !currentUser) return;

    try {
        let restaurant = null;

        // Fetch restaurants to support managing and switching
        const { data: allRests, error: fetchErr } = await db
            .from("restaurants")
            .select("id,name,description,image_url,is_open,slug,owner_id")
            .order("name");

        if (fetchErr) console.error("Error fetching restaurants list:", fetchErr);
        availableRestaurantsForStaff = allRests || [];

        const savedRid = requestedRestaurantId || localStorage.getItem("quickbite_active_restaurant_id");

        if (currentRole === "admin") {
            // Admin can manage ANY restaurant. Fallback to saved, owned, or first in directory.
            restaurant = availableRestaurantsForStaff.find(r => r.id === savedRid)
                || availableRestaurantsForStaff.find(r => r.owner_id === currentUser.id)
                || availableRestaurantsForStaff[0]
                || null;
        } else {
            // Restaurant partner: must be owner
            const ownedRests = availableRestaurantsForStaff.filter(r => r.owner_id === currentUser.id);
            restaurant = (savedRid ? ownedRests.find(r => r.id === savedRid) : null)
                || ownedRests[0]
                || null;
        }

        currentRestaurantRecord = restaurant;

        const claimCard = document.getElementById("restaurantClaimCard");
        const mainLayout = document.getElementById("restaurantMainLayout");
        const storeSwitcherWrap = document.getElementById("restStoreSwitcherWrap");
        const storeSelect = document.getElementById("restStoreSelect");

        if (!restaurant) {
            // Restaurant partner has no restaurant linked yet
            if (claimCard) claimCard.style.display = "flex";
            if (mainLayout) mainLayout.style.display = "none";
            if (storeSwitcherWrap) storeSwitcherWrap.style.display = "none";
            document.getElementById("restHeroName").textContent = "Unlinked Partner Account";
            document.getElementById("restHeroDesc").textContent = "Please link your partner restaurant from the directory below to manage orders and menus.";
            await populateUnassignedRestaurants();
            return;
        }

        // Restaurant is assigned or admin managing!
        if (claimCard) claimCard.style.display = "none";
        if (mainLayout) mainLayout.style.display = "block";

        localStorage.setItem("quickbite_active_restaurant_id", restaurant.id);
        if (currentProfile) {
            currentProfile.restaurant_id = restaurant.id;
            currentProfile.restaurant_name = restaurant.name;
        }

        // Populate Storefront Hero Card
        document.getElementById("restHeroName").textContent = restaurant.name;
        document.getElementById("restHeroDesc").textContent = restaurant.description || "Authentic freshly prepared meals with signature chef recipes.";
        
        const ownerDisplay = restaurant.owner_id === currentUser.id
            ? `👤 Owner: ${currentProfile?.full_name || "Partner Kitchen"}`
            : currentRole === "admin"
            ? `👤 Admin View (${restaurant.owner_id ? "Partner Owned" : "Unclaimed Store"})`
            : `👤 Partner Kitchen`;
        document.getElementById("restOwnerPill").textContent = ownerDisplay;

        const heroImg = document.getElementById("restHeroImg");
        if (heroImg) {
            heroImg.src = restaurant.image_url || CATEGORY_FALLBACK_IMAGES["Default"];
        }

        // Store Open/Closed Status
        const statusPill = document.getElementById("restStoreStatusPill");
        const statusToggleBtn = document.getElementById("restaurantOpenToggleBtn");
        const statusToggleText = document.getElementById("restOpenToggleText");

        if (statusPill && statusToggleBtn && statusToggleText) {
            if (restaurant.is_open) {
                statusPill.textContent = "🟢 Store Online";
                statusPill.className = "store-status-pill status-open";
                statusToggleText.textContent = "Accepting Orders";
                statusToggleBtn.className = "btn-store-status is-open";
            } else {
                statusPill.textContent = "🔴 Store Offline";
                statusPill.className = "store-status-pill status-closed";
                statusToggleText.textContent = "Store Paused";
                statusToggleBtn.className = "btn-store-status is-closed";
            }
        }

        // Populate Store Switcher Dropdown (Admin or partner with multiple stores)
        if (storeSwitcherWrap && storeSelect) {
            const manageableRests = (currentRole === "admin")
                ? availableRestaurantsForStaff
                : availableRestaurantsForStaff.filter(r => r.owner_id === currentUser.id);

            if (manageableRests.length > 1 || currentRole === "admin") {
                storeSwitcherWrap.style.display = "inline-flex";
                storeSelect.innerHTML = manageableRests.map(r => `
                    <option value="${r.id}" ${r.id === restaurant.id ? "selected" : ""}>
                        ${escapeHtml(r.name)} ${r.is_open ? "🟢" : "🔴"}
                    </option>
                `).join("");
            } else {
                storeSwitcherWrap.style.display = "none";
            }
        }

        // Preparation Time
        const savedPrepTime = localStorage.getItem(`quickbite_rest_preptime_${restaurant.id}`) || "20";
        const prepTag = document.getElementById("restPrepTimeTag");
        if (prepTag) prepTag.textContent = `⏱️ ~${savedPrepTime} mins avg prep`;

        // Pre-fill Settings Form
        const settingName = document.getElementById("settingRestName");
        const settingDesc = document.getElementById("settingRestDesc");
        const settingImg = document.getElementById("settingRestImg");
        const settingPrep = document.getElementById("settingRestPrepTime");
        if (settingName) settingName.value = restaurant.name || "";
        if (settingDesc) settingDesc.value = restaurant.description || "";
        if (settingPrep) settingPrep.value = savedPrepTime;
        if (settingImg) {
            settingImg.value = restaurant.image_url || "";
            previewSettingsCover(restaurant.image_url || "");
        }

        // Load Menu Items for this restaurant
        await loadRestaurantMenuDishes();

        // Load Orders & KDS queue
        await loadRestaurantOrders();

        // Load Analytics
        loadRestaurantAnalytics();
    } catch (err) {
        console.error("Error in loadRestaurantData:", err);
        showToast("Error loading restaurant portal data.", "error");
    }
}

async function loadRestaurantMenuDishes() {
    const rid = getActiveRestaurantId();
    if (!rid || !db) return;

    try {
        const { data: items, error } = await db
            .from("menu_items")
            .select("id,name,category,description,price,image_url,is_available")
            .eq("restaurant_id", rid)
            .order("created_at", { ascending: false });

        if (error) throw error;
        activeRestaurantDishes = items || [];

        // Update Dish Counter Badges
        const totalDishes = activeRestaurantDishes.length;
        const inStockCount = activeRestaurantDishes.filter(i => i.is_available).length;

        const statDishes = document.getElementById("restStatDishes");
        if (statDishes) statDishes.textContent = `${totalDishes} (${inStockCount} active)`;
        const badgeTotal = document.getElementById("restBadgeTotalDishes");
        if (badgeTotal) badgeTotal.textContent = totalDishes;
        const itemCountBadge = document.getElementById("restaurantItemCountBadge");
        if (itemCountBadge) itemCountBadge.textContent = `${totalDishes} items listed`;

        filterRestaurantMenu();
    } catch (err) {
        console.error("Error loading menu dishes:", err);
        const tbody = document.querySelector("#restaurantMenuTable tbody");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:25px;">Failed to load dishes. <button class="btn-sm btn-outline" onclick="loadRestaurantMenuDishes()" style="margin-left:8px;">🔄 Retry</button></td></tr>`;
        }
    }
}

function filterRestaurantMenu() {
    const query = (document.getElementById("restMenuSearchInput")?.value || "").trim().toLowerCase();
    const cat = document.getElementById("restMenuCategoryFilter")?.value || "All";
    const stock = document.getElementById("restMenuStockFilter")?.value || "All";

    let filtered = activeRestaurantDishes;
    if (query) {
        filtered = filtered.filter(i =>
            `${i.name} ${i.category} ${i.description || ""}`.toLowerCase().includes(query)
        );
    }
    if (cat !== "All") {
        filtered = filtered.filter(i => i.category === cat);
    }
    if (stock === "in_stock") {
        filtered = filtered.filter(i => i.is_available);
    } else if (stock === "out_of_stock") {
        filtered = filtered.filter(i => !i.is_available);
    }

    renderRestaurantMenuTable(filtered);
}

function renderRestaurantMenuTable(items) {
    const tbody = document.querySelector("#restaurantMenuTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#888;padding:35px;">No dishes match your filter criteria. <button class="btn-primary" style="margin-left:10px;padding:4px 10px;font-size:12px;" onclick="openAddDishModal()">+ Add Dish</button></td></tr>`;
        return;
    }

    items.forEach(dish => {
        const tr = document.createElement("tr");
        const safeImg = escapeHtml(dish.image_url || CATEGORY_FALLBACK_IMAGES[dish.category] || CATEGORY_FALLBACK_IMAGES["Default"]);
        const isAvail = !!dish.is_available;
        const stockBadge = isAvail
            ? `<span class="badge-stock-in">🟢 In Stock</span>`
            : `<span class="badge-stock-out">⚪ Sold Out</span>`;
        const toggleText = isAvail ? "Mark Sold Out" : "Mark In Stock";

        // Determine dietary badge
        const descText = dish.description || "";
        const isPureVeg = descText.includes("[Veg]") || (!descText.includes("[Non-Veg]") && !/(chicken|mutton|egg|fish|prawn|meat|beef|tandoori chicken)/i.test(dish.name));
        const dietaryBadge = isPureVeg 
            ? `<span class="badge-veg">🟢 Veg</span>` 
            : `<span class="badge-nonveg">🔴 Non-Veg</span>`;

        const cleanDesc = descText.replace(/^\[(Veg|Non-Veg)\]\s*/i, "");

        tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${safeImg}" alt="${escapeHtml(dish.name)}" class="dish-table-img" onerror="handleImageError(this, '${escapeHtml(dish.category)}')">
                    <div>
                        <div class="dish-table-name-wrap">
                            <strong>${escapeHtml(dish.name)}</strong>
                            ${dietaryBadge}
                        </div>
                        <div style="font-size:12px;color:#888;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(cleanDesc)}</div>
                    </div>
                </div>
            </td>
            <td><span class="tag-badge" style="font-size:11px;">${escapeHtml(dish.category)}</span></td>
            <td><strong>${money(dish.price)}</strong></td>
            <td>${stockBadge}</td>
            <td>
                <button class="btn-table-action" onclick="toggleDishAvailability('${dish.id}', ${isAvail}, this)">${toggleText}</button>
            </td>
            <td>
                <button class="btn-table-action" onclick="openEditDishModal('${dish.id}')">✏️ Edit</button>
                <button class="btn-table-action btn-danger-outline" onclick="deleteMenuItem('${dish.id}')">🗑️ Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadRestaurantOrders() {
    const rid = getActiveRestaurantId();
    if (!rid || !db) return;

    try {
        const { data, error } = await db
            .from("orders")
            .select("id,order_number,total_amount,status,delivery_address,created_at,profiles!orders_customer_id_fkey(full_name,phone),order_items(quantity,unit_price,menu_items(name,category))")
            .eq("restaurant_id", rid)
            .order("created_at", { ascending: false });

        if (error) throw error;
        activeRestaurantOrders = data || [];

        // Check if brand new pending order arrived
        const currentPending = activeRestaurantOrders.filter(o => o.status === "pending");
        const hasBrandNewPending = currentPending.some(o => !knownPendingOrderIds.has(o.id));
        if (hasBrandNewPending && knownPendingOrderIds.size > 0 && restaurantActiveTab === "orders") {
            playKitchenChime();
        }
        knownPendingOrderIds = new Set(currentPending.map(o => o.id));

        // Compute Restaurant KPIs with local date comparison
        const today = new Date();
        const todayFulfilled = activeRestaurantOrders.filter(o => {
            if (o.status !== "delivered" || !o.created_at) return false;
            const od = new Date(o.created_at);
            return od.getFullYear() === today.getFullYear() && od.getMonth() === today.getMonth() && od.getDate() === today.getDate();
        });
        const todayRevenue = todayFulfilled.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        const activeQueue = activeRestaurantOrders.filter(o => ["pending", "confirmed", "preparing", "ready_for_pickup", "picked_up"].includes(o.status));
        const completedTotal = activeRestaurantOrders.filter(o => o.status === "delivered").length;
        const historyTotal = activeRestaurantOrders.filter(o => ["delivered", "cancelled"].includes(o.status)).length;

        document.getElementById("restStatRevenue").textContent = money(todayRevenue);
        document.getElementById("restStatActiveQueue").textContent = activeQueue.length;
        document.getElementById("restBadgeActiveOrders").textContent = activeQueue.length;
        document.getElementById("restStatCompletedOrders").textContent = completedTotal;

        // Sub-filter counts
        document.getElementById("kdsCountAll").textContent = activeQueue.length;
        document.getElementById("kdsCountPending").textContent = activeRestaurantOrders.filter(o => o.status === "pending").length;
        document.getElementById("kdsCountCooking").textContent = activeRestaurantOrders.filter(o => ["confirmed", "preparing"].includes(o.status)).length;
        document.getElementById("kdsCountReady").textContent = activeRestaurantOrders.filter(o => o.status === "ready_for_pickup").length;
        const historyBadge = document.getElementById("kdsCountHistory");
        if (historyBadge) historyBadge.textContent = historyTotal;

        renderKitchenOrders();
    } catch (err) {
        console.error("Error loading restaurant orders:", err);
        const container = document.getElementById("restaurantOrdersList");
        if (container) {
            container.innerHTML = `<div class="no-orders-message" style="grid-column:1/-1; padding:35px 20px; text-align:center; color:#ef4444; background:white; border-radius:16px; border:1px solid #fecdd3;">Failed to load kitchen orders queue. <button class="btn-sm btn-outline" onclick="loadRestaurantOrders()" style="margin-left:10px;">🔄 Retry</button></div>`;
        }
    }
}

function filterKitchenOrders(filterType, btnEl) {
    kitchenFilterStatus = filterType;
    document.querySelectorAll(".kds-filter-chip").forEach(c => c.classList.remove("active"));
    if (btnEl) btnEl.classList.add("active");
    renderKitchenOrders();
}

function renderKitchenOrders() {
    const container = document.getElementById("restaurantOrdersList");
    if (!container) return;
    container.innerHTML = "";

    let filtered = [];
    if (kitchenFilterStatus === "all") {
        filtered = activeRestaurantOrders.filter(o => ["pending", "confirmed", "preparing", "ready_for_pickup", "picked_up"].includes(o.status));
    } else if (kitchenFilterStatus === "pending") {
        filtered = activeRestaurantOrders.filter(o => o.status === "pending");
    } else if (kitchenFilterStatus === "cooking") {
        filtered = activeRestaurantOrders.filter(o => ["confirmed", "preparing"].includes(o.status));
    } else if (kitchenFilterStatus === "ready") {
        filtered = activeRestaurantOrders.filter(o => o.status === "ready_for_pickup");
    } else if (kitchenFilterStatus === "history") {
        filtered = activeRestaurantOrders.filter(o => ["delivered", "cancelled"].includes(o.status));
    }

    if (!filtered.length) {
        const emptyMsg = kitchenFilterStatus === "pending"
            ? "No new orders waiting for acceptance. Kitchen queue is clear!"
            : kitchenFilterStatus === "cooking"
            ? "No meals currently cooking in the kitchen."
            : kitchenFilterStatus === "ready"
            ? "No packaged orders waiting for rider pickup."
            : kitchenFilterStatus === "history"
            ? "No completed or cancelled orders in history yet."
            : "No active orders right now. Real-time orders will display here automatically.";

        container.innerHTML = `<div class="no-orders-message" style="grid-column:1/-1; padding:45px 20px; text-align:center; background:white; border-radius:16px; border:1px solid var(--border);">${emptyMsg}</div>`;
        return;
    }

    filtered.forEach(o => {
        const customer = escapeHtml(o.profiles?.full_name || "Customer");
        const phone = o.profiles?.phone ? ` &bull; 📞 ${escapeHtml(o.profiles.phone)}` : "";
        const orderDate = formatDate(o.created_at);
        const cardTypeClass = o.status === "pending" ? "kds-card-pending" : ["confirmed", "preparing"].includes(o.status) ? "kds-card-cooking" : o.status === "ready_for_pickup" ? "kds-card-ready" : "";

        // Build item rows
        const itemsHtml = (o.order_items || []).map(i => `
            <div class="kds-item-row">
                <div>
                    <span class="kds-qty-badge">${i.quantity}x</span>
                    <strong>${escapeHtml(i.menu_items?.name || "Special Dish")}</strong>
                </div>
                <span>${money(Number(i.unit_price) * Number(i.quantity))}</span>
            </div>
        `).join("");

        // Action Buttons
        let actionBtnHtml = "";
        if (o.status === "pending") {
            actionBtnHtml = `
                <div class="kds-actions">
                    <button class="btn-primary" onclick="advanceRestaurantOrder('${o.id}', 'pending')">✓ Accept & Start Prep</button>
                    <button class="btn-kot" onclick="openPrintKotModal('${o.id}')" title="Print Kitchen Order Ticket">🖨️ KOT</button>
                </div>
                <button class="btn-decline-order" style="width:100%;margin-top:8px;" onclick="declineRestaurantOrder('${o.id}')">Decline Order ✕</button>
            `;
        } else if (o.status === "confirmed") {
            actionBtnHtml = `
                <div class="kds-actions">
                    <button class="btn-primary" style="background:#3b82f6;" onclick="advanceRestaurantOrder('${o.id}', 'confirmed')">👨‍🍳 Start Cooking</button>
                    <button class="btn-kot" onclick="openPrintKotModal('${o.id}')">🖨️ KOT</button>
                </div>
                <button class="btn-decline-order" style="width:100%;margin-top:8px;" onclick="declineRestaurantOrder('${o.id}')">Decline Order ✕</button>
            `;
        } else if (o.status === "preparing") {
            actionBtnHtml = `
                <div class="kds-actions">
                    <button class="btn-primary" style="background:#10b981;" onclick="advanceRestaurantOrder('${o.id}', 'preparing')">📦 Mark Ready for Pickup</button>
                    <button class="btn-kot" onclick="openPrintKotModal('${o.id}')">🖨️ KOT</button>
                </div>
            `;
        } else if (o.status === "ready_for_pickup") {
            actionBtnHtml = `
                <div class="restaurant-waiting" style="margin-bottom:8px;">🛵 Awaiting Rider Pickup</div>
                <button class="btn-kot full-width" onclick="openPrintKotModal('${o.id}')">🖨️ Print Kitchen Ticket</button>
            `;
        } else if (o.status === "picked_up") {
            actionBtnHtml = `
                <div class="restaurant-waiting" style="background:#eff6ff;color:#1e40af;margin-bottom:8px;">🛵 Out for Delivery with Rider</div>
                <button class="btn-kot full-width" onclick="openPrintKotModal('${o.id}')">🖨️ View Receipt</button>
            `;
        } else {
            actionBtnHtml = `<button class="btn-kot full-width" onclick="openPrintKotModal('${o.id}')">🖨️ View Ticket</button>`;
        }

        const card = document.createElement("article");
        card.className = `kds-card ${cardTypeClass}`;
        card.innerHTML = `
            <div>
                <div class="kds-card-header">
                    <div>
                        <div class="kds-order-num">#${escapeHtml(o.order_number)}</div>
                        <div style="font-size:12px;color:#888;margin-top:2px;">${orderDate}</div>
                    </div>
                    <span class="kds-time-pill">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span>
                </div>
                <div class="kds-customer-row">
                    👤 <strong>${customer}</strong>${phone}
                </div>
                <div class="kds-items-list">
                    ${itemsHtml || "<p style='color:#888;font-size:12px;'>No item details</p>"}
                </div>
                <div class="kds-address">
                    📍 <strong>Drop-off:</strong> ${escapeHtml(o.delivery_address || "Address not provided")}
                </div>
            </div>
            <div>
                <div class="kds-footer">
                    <span style="font-size:13px;color:#64748b;">Order Total:</span>
                    <strong class="kds-total">${money(o.total_amount)}</strong>
                </div>
                ${actionBtnHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

async function advanceRestaurantOrder(id, status) {
    const nextMap = {
        pending: "confirmed",
        confirmed: "preparing",
        preparing: "ready_for_pickup"
    };
    const nextStatus = nextMap[status];
    if (!nextStatus) return;

    try {
        const { error } = await db.from("orders").update({ status: nextStatus }).eq("id", id);
        if (error) throw error;
        showToast(`Order status updated: ${STATUS_LABELS[nextStatus]} ✓`, "success");
        await loadRestaurantOrders();
    } catch (err) {
        console.error("Advance order error:", err);
        showToast(err.message || "Failed to update order status.", "error");
    }
}

async function declineRestaurantOrder(id) {
    const ok = confirm("Decline and cancel this incoming order? The customer will be informed.");
    if (!ok) return;

    try {
        const { error } = await db.from("orders").update({ status: "cancelled" }).eq("id", id);
        if (error) throw error;
        showToast("Order declined.", "info");
        await loadRestaurantOrders();
    } catch (err) {
        console.error("Decline order error:", err);
        showToast(err.message || "Failed to decline order.", "error");
    }
}

// ================= KITCHEN ORDER TICKET (KOT) MODAL =================
function openPrintKotModal(orderId) {
    const order = activeRestaurantOrders.find(o => String(o.id) === String(orderId));
    if (!order) return showToast("Order details not found.", "error");

    const restaurantName = currentRestaurantRecord?.name || currentProfile?.restaurant_name || "QuickBite Kitchen";
    document.getElementById("kotRestaurantName").textContent = restaurantName;
    document.getElementById("kotOrderNumber").textContent = `#${order.order_number}`;
    document.getElementById("kotOrderTime").textContent = formatDate(order.created_at);
    document.getElementById("kotCustomerName").textContent = order.profiles?.full_name || "Customer";

    const phoneRow = document.getElementById("kotCustomerPhoneRow");
    const phoneEl = document.getElementById("kotCustomerPhone");
    if (phoneRow && phoneEl) {
        if (order.profiles?.phone) {
            phoneEl.textContent = order.profiles.phone;
            phoneRow.style.display = "flex";
        } else {
            phoneRow.style.display = "none";
        }
    }

    document.getElementById("kotOrderTotal").textContent = money(order.total_amount);
    document.getElementById("kotDeliveryAddress").textContent = order.delivery_address || "Not specified";

    const tbody = document.getElementById("kotItemsTbody");
    tbody.innerHTML = (order.order_items || []).map(item => `
        <tr>
            <td style="font-weight:bold;">${item.quantity}x</td>
            <td>${escapeHtml(item.menu_items?.name || "Dish")}</td>
            <td style="text-align:right;">${money(Number(item.unit_price) * Number(item.quantity))}</td>
        </tr>
    `).join("");

    document.getElementById("modalPrintKot").style.display = "flex";
}

function closePrintKotModal() {
    document.getElementById("modalPrintKot").style.display = "none";
}

function printKotSlip() {
    window.print();
}

// ================= RESTAURANT MENU MODALS (ADD & EDIT) =================
function openAddDishModal() {
    const modal = document.getElementById("modalAddDish");
    if (!modal) return;
    document.getElementById("addDishName").value = "";
    document.getElementById("addDishPrice").value = "";
    document.getElementById("addDishImage").value = "";
    document.getElementById("addDishDesc").value = "";
    const vegRadio = document.querySelector('input[name="dishDietary"][value="veg"]');
    if (vegRadio) vegRadio.checked = true;
    document.getElementById("addDishImgPreview").style.display = "none";
    modal.style.display = "flex";
}

function closeAddDishModal() {
    const modal = document.getElementById("modalAddDish");
    if (modal) modal.style.display = "none";
}

function previewModalDishImage(url, previewImgId) {
    const imgEl = document.getElementById(previewImgId);
    if (!imgEl) return;
    if (url && url.startsWith("http")) {
        imgEl.src = url;
        imgEl.style.display = "block";
        imgEl.onerror = () => { imgEl.style.display = "none"; };
    } else {
        imgEl.style.display = "none";
    }
}

async function handleAddNewDish(e) {
    e.preventDefault();
    const rid = getActiveRestaurantId();
    if (!rid) return showToast("No restaurant assigned to manage.", "error");

    const name = document.getElementById("addDishName").value.trim();
    const category = document.getElementById("addDishCategory").value;
    const price = Number(document.getElementById("addDishPrice").value);
    const imageUrl = document.getElementById("addDishImage").value.trim();
    let desc = document.getElementById("addDishDesc").value.trim();
    const dietary = document.querySelector('input[name="dishDietary"]:checked')?.value || "veg";

    if (!name || isNaN(price) || price <= 0) return showToast("Please enter a valid dish name and price.", "warning");

    // Cleanly tag dietary type into description
    const dietaryTag = dietary === "veg" ? "[Veg]" : "[Non-Veg]";
    if (!desc.startsWith("[Veg]") && !desc.startsWith("[Non-Veg]")) {
        desc = `${dietaryTag} ${desc}`;
    }

    const btn = document.getElementById("btnSubmitAddDish");
    if (btn) btn.disabled = true;

    try {
        const row = {
            restaurant_id: rid,
            name: name,
            category: category,
            price: price,
            image_url: imageUrl || CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES["Default"],
            description: desc,
            is_available: true
        };

        const { error } = await db.from("menu_items").insert(row);
        if (error) throw error;

        closeAddDishModal();
        showToast(`✓ "${name}" added to your live menu!`, "success");
        await loadRestaurantMenuDishes();
        await loadMenu();
    } catch (err) {
        console.error("Add dish error:", err);
        showToast(err.message || "Failed to add dish.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openEditDishModal(dishId) {
    const dish = activeRestaurantDishes.find(d => String(d.id) === String(dishId));
    if (!dish) return showToast("Dish details not found.", "error");

    document.getElementById("editDishId").value = dish.id;
    document.getElementById("editDishName").value = dish.name;
    document.getElementById("editDishCategory").value = dish.category;
    document.getElementById("editDishPrice").value = dish.price;
    document.getElementById("editDishImage").value = dish.image_url || "";
    
    // Clean description and set dietary radio
    const rawDesc = dish.description || "";
    const isNonVeg = rawDesc.includes("[Non-Veg]") || /(chicken|mutton|egg|fish|prawn|meat|beef|tandoori chicken)/i.test(dish.name);
    if (document.getElementById("editDishDietaryNonVeg")) {
        document.getElementById("editDishDietaryNonVeg").checked = isNonVeg;
        document.getElementById("editDishDietaryVeg").checked = !isNonVeg;
    }
    document.getElementById("editDishDesc").value = rawDesc.replace(/^\[(Veg|Non-Veg)\]\s*/i, "");
    document.getElementById("editDishAvailable").checked = !!dish.is_available;

    previewModalDishImage(dish.image_url || "", "editDishImgPreview");
    document.getElementById("modalEditDish").style.display = "flex";
}

function closeEditDishModal() {
    document.getElementById("modalEditDish").style.display = "none";
}

async function handleSaveEditDish(e) {
    e.preventDefault();
    const dishId = document.getElementById("editDishId").value.trim();
    const name = document.getElementById("editDishName").value.trim();
    const category = document.getElementById("editDishCategory").value;
    const price = Number(document.getElementById("editDishPrice").value);
    const imageUrl = document.getElementById("editDishImage").value.trim();
    let desc = document.getElementById("editDishDesc").value.trim();
    const isAvailable = document.getElementById("editDishAvailable").checked;
    const dietary = document.querySelector('input[name="editDishDietary"]:checked')?.value || "veg";

    if (!name || isNaN(price) || price <= 0) return showToast("Please enter valid details.", "warning");

    const dietaryTag = dietary === "veg" ? "[Veg]" : "[Non-Veg]";
    if (!desc.startsWith("[Veg]") && !desc.startsWith("[Non-Veg]")) {
        desc = `${dietaryTag} ${desc}`;
    }

    const btn = document.getElementById("btnSubmitEditDish");
    if (btn) btn.disabled = true;

    try {
        const { error } = await db.from("menu_items").update({
            name: name,
            category: category,
            price: price,
            image_url: imageUrl || CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES["Default"],
            description: desc,
            is_available: isAvailable,
            updated_at: new Date().toISOString()
        }).eq("id", dishId);

        if (error) throw error;

        closeEditDishModal();
        showToast(`✓ Dish "${name}" updated successfully!`, "success");
        await loadRestaurantMenuDishes();
        await loadMenu();
    } catch (err) {
        console.error("Save edit dish error:", err);
        showToast(err.message || "Failed to update dish.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function toggleDishAvailability(id, currentStatus, btnEl) {
    if (btnEl) btnEl.disabled = true;
    try {
        const { error } = await db.from("menu_items").update({ is_available: !currentStatus }).eq("id", id);
        if (error) throw error;
        showToast(`Dish marked as ${!currentStatus ? "In Stock" : "Sold Out"}.`, "info");
        await loadRestaurantMenuDishes();
        await loadMenu();
    } catch (err) {
        console.error("Toggle dish error:", err);
        showToast(err.message || "Failed to update stock status.", "error");
    } finally {
        if (btnEl) btnEl.disabled = false;
    }
}

async function deleteMenuItem(id) {
    const ok = confirm("Are you sure you want to permanently delete this dish from the menu?");
    if (!ok) return;

    try {
        const { error: delErr } = await db.from("menu_items").delete().eq("id", id);
        if (delErr) {
            // Soft delete fallback if foreign key or cascade constraint applies
            const { error: updErr } = await db.from("menu_items").update({ is_available: false }).eq("id", id);
            if (updErr) throw updErr;
            showToast("Dish has order history and was marked as Sold Out / Disabled.", "warning");
        } else {
            showToast("Dish permanently removed from menu.", "info");
        }
        await loadRestaurantMenuDishes();
        await loadMenu();
    } catch (err) {
        console.error("Delete dish error:", err);
        showToast(err.message || "Failed to delete dish.", "error");
    }
}

// ================= RESTAURANT ANALYTICS & SETTINGS =================
function loadRestaurantAnalytics() {
    const tbody = document.getElementById("restTopDishesTbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Calculate dynamic fulfillment rate
    const totalOrders = activeRestaurantOrders.length;
    const deliveredCount = activeRestaurantOrders.filter(o => o.status === "delivered").length;
    const cancelledCount = activeRestaurantOrders.filter(o => o.status === "cancelled").length;
    const closedCount = deliveredCount + cancelledCount;
    const rateEl = document.getElementById("restStatFulfillmentRate");
    if (rateEl) {
        if (closedCount > 0) {
            const rate = ((deliveredCount / closedCount) * 100).toFixed(1);
            rateEl.textContent = `${rate}%`;
        } else {
            rateEl.textContent = totalOrders > 0 ? "100%" : "N/A";
        }
    }

    // Calculate item sales from activeRestaurantOrders
    const salesMap = {};
    activeRestaurantOrders.forEach(o => {
        if (o.status === "cancelled") return;
        (o.order_items || []).forEach(item => {
            const name = item.menu_items?.name || "Dish";
            const category = item.menu_items?.category || "Specialty";
            const price = Number(item.unit_price || 0);
            const qty = Number(item.quantity || 1);
            if (!salesMap[name]) {
                salesMap[name] = { name, category, count: 0, revenue: 0, price };
            }
            salesMap[name].count += qty;
            salesMap[name].revenue += price * qty;
        });
    });

    const topList = Object.values(salesMap).sort((a, b) => b.count - a.count).slice(0, 5);

    if (!topList.length) {
        // Fallback demo statistics based on active menu items
        const demoTop = activeRestaurantDishes.slice(0, 4).map((d, idx) => ({
            name: d.name,
            category: d.category,
            price: d.price,
            count: 35 - idx * 7,
            revenue: (35 - idx * 7) * d.price
        }));

        tbody.innerHTML = demoTop.map(d => `
            <tr>
                <td><strong>${escapeHtml(d.name)}</strong></td>
                <td><span class="tag-badge" style="font-size:11px;">${escapeHtml(d.category)}</span></td>
                <td>${money(d.price)}</td>
                <td><strong>${d.count} units</strong></td>
                <td><strong style="color:var(--primary);">${money(d.revenue)}</strong></td>
            </tr>
        `).join("");
        return;
    }

    tbody.innerHTML = topList.map(d => `
        <tr>
            <td><strong>${escapeHtml(d.name)}</strong></td>
            <td><span class="tag-badge" style="font-size:11px;">${escapeHtml(d.category)}</span></td>
            <td>${money(d.price)}</td>
            <td><strong>${d.count} units</strong></td>
            <td><strong style="color:var(--primary);">${money(d.revenue)}</strong></td>
        </tr>
    `).join("");
}

function previewSettingsCover(url) {
    const previewEl = document.getElementById("settingsPreviewImgEl");
    if (!previewEl) return;
    if (url && url.startsWith("http")) {
        previewEl.src = url;
        previewEl.style.display = "block";
        previewEl.onerror = () => { previewEl.style.display = "none"; };
    } else {
        previewEl.style.display = "none";
    }
}

async function saveRestaurantSettings(e) {
    e.preventDefault();
    const rid = getActiveRestaurantId();
    if (!rid) return showToast("No restaurant assigned to manage.", "error");

    const name = document.getElementById("settingRestName").value.trim();
    const desc = document.getElementById("settingRestDesc").value.trim();
    const img = document.getElementById("settingRestImg").value.trim();
    const prepTime = Number(document.getElementById("settingRestPrepTime")?.value || 20);

    const btn = document.getElementById("btnSaveRestSettings");
    if (btn) btn.disabled = true;

    try {
        const { error } = await db.from("restaurants").update({
            name: name,
            description: desc,
            image_url: img,
            updated_at: new Date().toISOString()
        }).eq("id", rid);

        if (error) throw error;

        // Persist prep time locally
        localStorage.setItem(`quickbite_rest_preptime_${rid}`, prepTime);
        const prepTag = document.getElementById("restPrepTimeTag");
        if (prepTag) prepTag.textContent = `⏱️ ~${prepTime} mins avg prep`;

        showToast("✓ Storefront profile updated successfully!", "success");
        await loadRestaurantData(rid);
        await loadMenu();
    } catch (err) {
        console.error("Save restaurant settings error:", err);
        showToast(err.message || "Failed to update restaurant settings.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function populateUnassignedRestaurants() {
    try {
        const select = document.getElementById("claimRestaurantSelect");
        if (!select) return;
        const { data: restaurants } = await db.from("restaurants").select("id,name,slug,owner_id").is("owner_id", null).order("name");
        select.innerHTML = `<option value="">-- Choose an available restaurant --</option>`;
        if (!restaurants || !restaurants.length) {
            select.innerHTML += `<option value="" disabled>No unlinked partner restaurants currently available</option>`;
            return;
        }
        restaurants.forEach(r => {
            const opt = document.createElement("option");
            opt.value = r.id;
            opt.textContent = `${r.name} (${r.slug})`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Error populating restaurants:", e);
    }
}

async function handleClaimRestaurant() {
    const select = document.getElementById("claimRestaurantSelect");
    const restaurantId = select?.value;
    if (!restaurantId) return showToast("Please select a restaurant to claim.", "warning");

    try {
        const { error: rpcErr } = await db.rpc("claim_restaurant", { p_restaurant_id: restaurantId });
        if (rpcErr) {
            const { error: updateErr } = await db.from("restaurants").update({ owner_id: currentUser.id }).eq("id", restaurantId);
            if (updateErr) throw updateErr;
        }

        showToast("Restaurant linked successfully!", "success");
        await loadRestaurantData(restaurantId);
        await loadMenu();
    } catch (err) {
        console.error("Claim restaurant error:", err);
        showToast(err.message || "Failed to link restaurant.", "error");
    }
}

async function toggleCurrentRestaurantOpen() {
    const rid = getActiveRestaurantId();
    if (!rid) return;

    try {
        const { data: current } = await db.from("restaurants").select("is_open").eq("id", rid).single();
        const nextState = !current?.is_open;
        const { error } = await db.from("restaurants").update({ is_open: nextState }).eq("id", rid);
        if (error) throw error;

        showToast(`Storefront is now ${nextState ? "Open for Orders (Online)" : "Closed (Offline)"}.`, "success");
        await loadRestaurantData(rid);
    } catch (err) {
        console.error("Store status toggle error:", err);
        showToast("Could not update store status.", "error");
    }
}

// ================= DELIVERY FLEET (RIDER) PORTAL =================
async function loadRiderOrders() {
    if (currentRole !== "rider" && currentRole !== "admin") return;
    if (!db || !currentUser) return;

    try {
        const { data, error } = await db
            .from("orders")
            .select("id,order_number,total_amount,status,delivery_address,rider_id,created_at,profiles!orders_customer_id_fkey(full_name),restaurants(name),order_items(quantity,menu_items(name))")
            .in("status", ["ready_for_pickup", "picked_up", "delivered"])
            .order("created_at", { ascending: false });

        if (error) throw error;
        riderOrders = data || [];

        // Compute fleet stats
        const availableCount = riderOrders.filter(o => o.status === "ready_for_pickup" && !o.rider_id).length;
        const activeCount = riderOrders.filter(o => o.status === "picked_up" && o.rider_id === currentUser.id).length;
        const completedCount = riderOrders.filter(o => o.status === "delivered" && o.rider_id === currentUser.id).length;
        const earnings = completedCount * 50; // ₹50 delivery fee per completed order

        document.getElementById("riderStatAvailable").textContent = availableCount;
        document.getElementById("riderStatActive").textContent = activeCount;
        document.getElementById("riderStatCompleted").textContent = completedCount;
        document.getElementById("riderStatEarnings").textContent = earnings.toLocaleString("en-IN");

        document.getElementById("riderTabAvailableCount").textContent = availableCount;
        document.getElementById("riderTabActiveCount").textContent = activeCount;

        renderRiderOrders();
    } catch (err) {
        console.error("Error loading rider orders:", err);
    }
}

function switchRiderTab(tab) {
    riderTab = tab;
    document.querySelectorAll(".rider-tab-btn").forEach(btn => btn.classList.remove("active"));
    if (tab === "available") document.getElementById("riderTabAvailableBtn")?.classList.add("active");
    else if (tab === "active") document.getElementById("riderTabActiveBtn")?.classList.add("active");
    else if (tab === "history") document.getElementById("riderTabHistoryBtn")?.classList.add("active");
    renderRiderOrders();
}

function renderRiderOrders() {
    const list = document.getElementById("riderOrdersList");
    if (!list) return;
    list.innerHTML = "";

    let filtered = [];
    if (riderTab === "available") {
        filtered = riderOrders.filter(o => o.status === "ready_for_pickup" && !o.rider_id);
    } else if (riderTab === "active") {
        filtered = riderOrders.filter(o => o.status === "picked_up" && o.rider_id === currentUser.id);
    } else if (riderTab === "history") {
        filtered = riderOrders.filter(o => o.status === "delivered" && o.rider_id === currentUser.id);
    }

    if (!filtered.length) {
        const emptyMsg = riderTab === "available"
            ? "No orders ready for pickup right now. Check back as partner kitchens prepare food."
            : riderTab === "active"
            ? "You have no active deliveries in transit. Claim an available order to get started!"
            : "No completed delivery records found.";

        list.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 20px; background:white; border-radius:16px; border:1px solid var(--border); color:#777;">${emptyMsg}</div>`;
        return;
    }

    filtered.forEach(o => {
        const customerName = escapeHtml(o.profiles?.full_name || "Customer");
        const restaurantName = escapeHtml(o.restaurants?.name || "Kitchen");
        const items = (o.order_items || []).map(i => `${escapeHtml(i.menu_items?.name || "Dish")} &times; ${i.quantity}`).join(", ");
        const card = document.createElement("div");
        card.className = "delivery-card";

        let actionButtonHtml = "";
        if (riderTab === "available") {
            actionButtonHtml = `<button class="btn-primary full-width" onclick="claimRiderOrder('${o.id}')">⚡ Claim & Pick Up Order</button>`;
        } else if (riderTab === "active") {
            actionButtonHtml = `<button class="btn-primary full-width" style="background:#10b981;" onclick="completeRiderOrder('${o.id}')">✓ Confirm Doorstep Delivery</button>`;
        }

        card.innerHTML = `
            <div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <h4 style="font-size:16px; font-weight:800;">Order #${escapeHtml(o.order_number)}</h4>
                        <span style="font-size:12px; color:#888;">${formatDate(o.created_at)}</span>
                    </div>
                    <span class="delivery-status ${o.status === "delivered" ? "status-done" : "status-prep"}">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span>
                </div>
                <p style="font-size:13px; color:#333; margin-bottom:4px;">🏪 Pickup: <strong>${restaurantName}</strong></p>
                <p style="font-size:13px; color:#333; margin-bottom:8px;">👤 Customer: <strong>${customerName}</strong></p>
                <p style="font-size:13px; color:#666; margin-bottom:8px;">🍽️ ${items}</p>
                <p style="font-size:13px; color:#111; margin-bottom:8px; background:#f8f9fb; padding:8px; border-radius:6px;">📍 <strong>Drop-off:</strong> ${escapeHtml(o.delivery_address || "Address not provided")}</p>
                <p style="margin-bottom:12px;"><strong style="color:var(--primary); font-size:16px;">${money(o.total_amount)}</strong></p>
            </div>
            ${actionButtonHtml}
        `;
        list.appendChild(card);
    });
}

async function claimRiderOrder(orderId) {
    try {
        const { data, error } = await db.rpc("claim_delivery_order", { p_order_id: orderId });
        if (error) throw error;
        if (!data) return showToast("This delivery was already claimed by another rider.", "error");

        showToast("Order claimed! Pick up meals from the kitchen.", "success");
        riderTab = "active";
        await loadRiderOrders();
    } catch (err) {
        console.error("Claim order error:", err);
        showToast(err.message || "Failed to claim delivery.", "error");
    }
}

async function completeRiderOrder(orderId) {
    try {
        const { error } = await db.from("orders").update({ status: "delivered" }).eq("id", orderId).eq("rider_id", currentUser.id);
        if (error) throw error;

        showToast("Delivery confirmed! Great work.", "success");
        await loadRiderOrders();
    } catch (err) {
        console.error("Complete delivery error:", err);
        showToast(err.message || "Failed to complete delivery.", "error");
    }
}

// ================= PLATFORM ADMIN DASHBOARD =================
async function loadAdminDashboard() {
    if (currentRole !== "admin") return;
    if (!db) return;

    try {
        const [ordersRes, itemsRes, profilesRes] = await Promise.all([
            db.from("orders").select("id,order_number,total_amount,status,delivery_address,created_at,profiles!orders_customer_id_fkey(full_name),restaurants(name),order_items(quantity,menu_items(name))").order("created_at", { ascending: false }),
            db.from("menu_items").select("id", { count: "exact", head: true }),
            db.from("profiles").select("id,role", { count: "exact" })
        ]);

        allAdminOrders = ordersRes.data || [];
        const totalRevenue = allAdminOrders.filter(o => o.status !== "cancelled").reduce((s, o) => s + Number(o.total_amount || 0), 0);
        const totalDishes = itemsRes.count || 0;
        const totalUsers = profilesRes.count || (profilesRes.data?.length || 0);

        document.getElementById("statTotalOrders").textContent = allAdminOrders.length;
        document.getElementById("statRevenue").textContent = totalRevenue.toLocaleString("en-IN");
        document.getElementById("statMenuItems").textContent = totalDishes;
        document.getElementById("statTotalUsers").textContent = totalUsers;

        renderAdminOrders();
    } catch (err) {
        console.error("Admin dashboard load error:", err);
    }
}

function switchAdminTab(tabName) {
    document.querySelectorAll(".admin-tab-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".admin-tab-pane").forEach(pane => pane.classList.remove("active"));

    if (tabName === "orders") {
        document.getElementById("adminTabBtnOrders")?.classList.add("active");
        document.getElementById("adminTabPaneOrders")?.classList.add("active");
        renderAdminOrders();
    } else if (tabName === "users") {
        document.getElementById("adminTabBtnUsers")?.classList.add("active");
        document.getElementById("adminTabPaneUsers")?.classList.add("active");
        loadAdminUsers();
    } else if (tabName === "restaurants") {
        document.getElementById("adminTabBtnRestaurants")?.classList.add("active");
        document.getElementById("adminTabPaneRestaurants")?.classList.add("active");
        loadAdminRestaurants();
    }
}

function filterAdminOrders(statusFilter, btn) {
    adminOrdersFilter = statusFilter;
    document.querySelectorAll(".order-filter-chips .filter-chip").forEach(c => c.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderAdminOrders();
}

function renderAdminOrders() {
    const tbody = document.querySelector("#adminOrdersTable tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = allAdminOrders;
    if (adminOrdersFilter === "pending") filtered = filtered.filter(o => o.status === "pending");
    else if (adminOrdersFilter === "in_progress") filtered = filtered.filter(o => ["confirmed", "preparing", "ready_for_pickup", "picked_up"].includes(o.status));
    else if (adminOrdersFilter === "delivered") filtered = filtered.filter(o => o.status === "delivered");
    else if (adminOrdersFilter === "cancelled") filtered = filtered.filter(o => o.status === "cancelled");

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#888;padding:25px;">No orders found in this filter.</td></tr>`;
        return;
    }

    filtered.forEach(o => {
        const customer = escapeHtml(o.profiles?.full_name || "Customer");
        const items = (o.order_items || []).map(i => `${escapeHtml(i.menu_items?.name || "Dish")} &times; ${i.quantity}`).join(", ");
        const restaurant = escapeHtml(o.restaurants?.name || "Kitchen");
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td><strong>#${escapeHtml(o.order_number)}</strong><div style="font-size:11px;color:#888;">${formatDate(o.created_at)}</div></td>
            <td>👤 ${customer}</td>
            <td><strong>${restaurant}</strong><div style="font-size:12px;color:#666;">${items || "No items"}</div></td>
            <td><strong>${money(o.total_amount)}</strong></td>
            <td><span class="delivery-status ${o.status === "delivered" ? "status-done" : o.status === "cancelled" ? "status-cancelled" : "status-prep"}">${escapeHtml(STATUS_LABELS[o.status] || o.status)}</span></td>
            <td>
                <select class="role-select" onchange="updateAdminOrderStatus('${o.id}', this.value)">
                    <option value="" disabled selected>Update Status</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="preparing">Preparing</option>
                    <option value="ready_for_pickup">Ready</option>
                    <option value="picked_up">Out for Delivery</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function updateAdminOrderStatus(orderId, newStatus) {
    if (!newStatus) return;
    try {
        const { error } = await db.from("orders").update({ status: newStatus }).eq("id", orderId);
        if (error) throw error;
        showToast(`Order status updated to: ${STATUS_LABELS[newStatus]}`, "success");
        await loadAdminDashboard();
    } catch (err) {
        console.error("Update admin order error:", err);
        showToast(err.message || "Failed to update order status.", "error");
    }
}

async function loadAdminUsers() {
    try {
        const { data: profiles, error } = await db.from("profiles").select("id,full_name,role,created_at").order("created_at", { ascending: false });
        if (error) throw error;

        const tbody = document.querySelector("#adminUsersTable tbody");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (!profiles || !profiles.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888;padding:25px;">No profiles found.</td></tr>`;
            return;
        }

        profiles.forEach(p => {
            const role = p.role || "user";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>👤 ${escapeHtml(p.full_name || "User")}</strong></td>
                <td><code style="font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;">${escapeHtml(p.id.substring(0, 8))}...</code></td>
                <td><span class="badge-role badge-role-${role}">${ROLE_LABELS[role] || role}</span></td>
                <td>
                    <select class="role-select" onchange="changeUserRole('${p.id}', this.value)">
                        <option value="user" ${role === "user" ? "selected" : ""}>Customer</option>
                        <option value="restaurant" ${role === "restaurant" ? "selected" : ""}>Restaurant Partner</option>
                        <option value="rider" ${role === "rider" ? "selected" : ""}>Delivery Rider</option>
                        <option value="admin" ${role === "admin" ? "selected" : ""}>Platform Admin</option>
                    </select>
                </td>
                <td><span style="font-size:12px;color:#777;">${formatDate(p.created_at)}</span></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Load users error:", err);
        showToast("Failed to load user profiles.", "error");
    }
}

async function changeUserRole(userId, newRole) {
    try {
        const { error: rpcErr } = await db.rpc("set_user_role", { p_user_id: userId, p_new_role: newRole });
        if (rpcErr) {
            const { error: updateErr } = await db.from("profiles").update({ role: newRole }).eq("id", userId);
            if (updateErr) throw updateErr;
        }

        showToast(`Role updated to ${ROLE_LABELS[newRole]}!`, "success");
        if (userId === currentUser?.id) {
            await loadSession();
        } else {
            await loadAdminUsers();
        }
    } catch (err) {
        console.error("Change role error:", err);
        showToast(err.message || "Failed to update role.", "error");
    }
}

async function loadAdminRestaurants() {
    try {
        const { data: restaurants, error } = await db.from("restaurants").select("id,name,slug,is_open,owner_id,profiles(full_name)").order("name");
        if (error) throw error;

        partnerRestaurants = restaurants || [];
        const tbody = document.querySelector("#adminRestaurantsTable tbody");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (!partnerRestaurants.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#888;padding:25px;">No restaurants found.</td></tr>`;
            return;
        }

        partnerRestaurants.forEach(r => {
            const tr = document.createElement("tr");
            const ownerDisplay = r.profiles?.full_name ? `👤 ${escapeHtml(r.profiles.full_name)}` : `<span style="color:#f59e0b;font-weight:600;">Unassigned</span>`;
            const statusBadge = r.is_open ? `<span class="badge-stock-in">Open</span>` : `<span class="badge-stock-out">Closed</span>`;

            tr.innerHTML = `
                <td><strong>🏪 ${escapeHtml(r.name)}</strong></td>
                <td><code>${escapeHtml(r.slug)}</code></td>
                <td>${ownerDisplay}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-table-action" onclick="toggleRestaurantStatusAdmin('${r.id}', ${r.is_open})">${r.is_open ? "Close Store" : "Open Store"}</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Load admin restaurants error:", err);
        showToast("Failed to load restaurants.", "error");
    }
}

async function toggleRestaurantStatusAdmin(restaurantId, currentOpen) {
    try {
        const { error } = await db.from("restaurants").update({ is_open: !currentOpen }).eq("id", restaurantId);
        if (error) throw error;
        showToast(`Restaurant is now ${!currentOpen ? "Open" : "Closed"}.`, "success");
        await loadAdminRestaurants();
    } catch (err) {
        console.error("Toggle store status error:", err);
        showToast(err.message || "Failed to update store status.", "error");
    }
}

// ================= REALTIME SUBSCRIPTIONS =================
function subscribeRealtime() {
    if (!db) return;

    try {
        db.channel("quickbite-live-all")
            .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async () => {
                if (activeRoleView === "orders") await loadCustomerOrders();
                else if (activeRoleView === "restaurant") {
                    await loadRestaurantOrders();
                    loadRestaurantAnalytics();
                }
                else if (activeRoleView === "rider") await loadRiderOrders();
                else if (activeRoleView === "admin") await loadAdminDashboard();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, async () => {
                await loadMenu();
                if (activeRoleView === "restaurant") await loadRestaurantMenuDishes();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "restaurants" }, async () => {
                if (activeRoleView === "admin") await loadAdminRestaurants();
                if (activeRoleView === "restaurant") {
                    const rid = getActiveRestaurantId();
                    if (rid) await loadRestaurantData(rid);
                }
            })
            .subscribe();
    } catch (err) {
        console.warn("Realtime subscription warning:", err);
    }
}

// ================= KEYBOARD ACCESSIBILITY =================
document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        closeLoginModal();
        closeProductDetailModal();
        closeAddDishModal();
        closeEditDishModal();
        closePrintKotModal();
        const cartModal = document.getElementById("cartModal");
        if (cartModal && cartModal.style.display === "flex") toggleCart();
    }
});

// ================= INITIALIZATION =================
(async function init() {
    try {
        await loadSession();
        await loadMenu();
        subscribeRealtime();

        if (db) {
            db.auth.onAuthStateChange(async (_event, session) => {
                const prevUserId = currentUser?.id;
                currentUser = session?.user || null;
                if (currentUser?.id !== prevUserId) {
                    await loadSession();
                    await loadMenu();
                }
            });
        }
    } catch (err) {
        console.error("Initialization error:", err);
        showToast("QuickBite could not fully initialize. Check Supabase connection.", "error");
    }
})();
