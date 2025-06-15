// Mobile menu handling
const toggleSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    sidebar.classList.toggle('active');
    mainContent.classList.toggle('shifted');
};

// Form validation
const validateForm = (formData) => {
    const errors = {};
    // Add validation logic here
    return errors;
};

// Toast notifications
const showToast = (message, type = 'success') => {
    Swal.fire({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        icon: type,
        title: message
    });
};

// URL parameter handling
const getQueryParam = (param) => {
    return new URLSearchParams(window.location.search).get(param);
};



// Navigation
const navigate = (page) => {
    const uid = getQueryParam('uid');
    if (!uid) return;

    if (page === '/') {
        window.location.href = `/?uid=${uid}`;
    } else {
        window.location.href = `/${page}.html?uid=${uid}`;
    }
};

// Cookie handling
const setCookie = (name, value, days = 7) => {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;SameSite=Strict;Secure=${location.protocol === 'https:'}`;
};

const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
};

// Animation helpers
const animate = (element, animation) => {
    element.classList.add(animation);
    element.addEventListener('animationend', () => {
        element.classList.remove(animation);
    });
}; 